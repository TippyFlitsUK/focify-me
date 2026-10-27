import { BlockList, isIP, connect } from "node:net";
import { createServer, request as httpRequest } from "node:http";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

const IPV4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV6_BLOCKED: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const blocked = new BlockList();
for (const [net, prefix] of IPV4_BLOCKED) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of IPV6_BLOCKED) blocked.addSubnet(net, prefix, "ipv6");
for (const addrs of Object.values(networkInterfaces())) {
  for (const a of addrs ?? []) {
    const address = a.address.split("%")[0];
    const family = isIP(address);
    if (family) blocked.addAddress(address, family === 6 ? "ipv6" : "ipv4");
  }
}

function privateNetworkAllowed(): boolean {
  return process.env.FOCIFY_ALLOW_PRIVATE_NETWORK === "1";
}

export function isBlockedIp(ip: string): boolean {
  if (privateNetworkAllowed()) return false;
  const family = isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

export async function resolvePublic(host: string): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isBlockedIp(bare)) throw new BlockedAddressError(`Blocked address: ${bare}`);
    return { address: bare, family: isIP(bare) };
  }
  let records: { address: string; family: number }[];
  try {
    records = await lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new BlockedAddressError(`Could not resolve ${bare}`);
  }
  if (records.length === 0) throw new BlockedAddressError(`Could not resolve ${bare}`);
  const bad = records.find((r) => isBlockedIp(r.address));
  if (bad) throw new BlockedAddressError(`${bare} resolves to a blocked address (${bad.address})`);
  return records[0];
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedAddressError(`Unsupported protocol: ${url.protocol}`);
  }
  await resolvePublic(url.hostname);
  return url;
}

export async function guardedFetch(raw: string, init: RequestInit = {}, maxRedirects = 10): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const resp = await fetch(current, { ...init, redirect: "manual" });
    const location = resp.headers.get("location");
    if (resp.status >= 300 && resp.status < 400 && location) {
      await resp.body?.cancel().catch(() => {});
      current = new URL(location, current).href;
      continue;
    }
    return resp;
  }
  throw new Error(`Too many redirects: ${raw}`);
}

const HOP_BY_HOP = new Set(["proxy-connection", "proxy-authorization", "proxy-authenticate"]);

function splitHostPort(authority: string): { host: string; port: number } {
  const m = authority.match(/^\[([^\]]+)\]:(\d+)$/) ?? authority.match(/^([^:]+):(\d+)$/);
  if (!m) return { host: authority, port: 443 };
  return { host: m[1], port: Number(m[2]) };
}

export async function startGuardProxy(): Promise<{ server: string; close: () => Promise<void> }> {
  const tunnels = new Set<Duplex>();
  const server = createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    resolvePublic(target.hostname).then(
      ({ address }) => {
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v !== undefined && !HOP_BY_HOP.has(k)) headers[k] = v;
        }
        const upstream = httpRequest(
          {
            host: address,
            port: target.port || 80,
            method: req.method,
            path: target.pathname + target.search,
            headers,
            setHost: false,
          },
          (up) => {
            res.writeHead(up.statusCode ?? 502, up.rawHeaders);
            up.pipe(res);
          },
        );
        upstream.on("error", () => res.destroy());
        req.pipe(upstream);
      },
      () => res.destroy(),
    );
  });

  server.on("connect", (req, clientSocket, head) => {
    const { host, port } = splitHostPort(req.url ?? "");
    tunnels.add(clientSocket);
    clientSocket.on("close", () => tunnels.delete(clientSocket));
    clientSocket.on("error", () => {});
    resolvePublic(host).then(
      ({ address }) => {
        const upstream = connect(port, address, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        upstream.on("error", () => clientSocket.destroy());
        clientSocket.on("close", () => upstream.destroy());
      },
      () => clientSocket.destroy(),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    server: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of tunnels) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
