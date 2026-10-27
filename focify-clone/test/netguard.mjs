import { createServer, request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";
import { isBlockedIp, assertPublicUrl, startGuardProxy } from "../dist/netguard.js";

delete process.env.FOCIFY_ALLOW_PRIVATE_NETWORK;

const failures = [];
const check = (ok, label) => {
  if (!ok) failures.push(label);
};

const ownAddresses = Object.values(networkInterfaces())
  .flat()
  .map((a) => a.address.split("%")[0]);

for (const ip of [
  "127.0.0.1",
  "169.254.169.254",
  "10.1.2.3",
  "172.17.0.1",
  "192.168.1.100",
  "100.64.0.1",
  "0.0.0.0",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:a9fe:a9fe",
  "fe80::1",
  "fd00::1",
  ...ownAddresses,
]) {
  check(isBlockedIp(ip), `blocked: ${ip}`);
}
for (const ip of ["1.1.1.1", "93.184.215.14", "2606:4700:4700::1111"]) {
  check(!isBlockedIp(ip), `allowed: ${ip}`);
}

for (const url of [
  "file:///etc/passwd",
  "http://169.254.169.254/latest/meta-data/",
  "http://0xA9FEA9FE/latest/meta-data/",
  "http://2852039166/latest/meta-data/",
  "http://169.254.169.254./latest/meta-data/",
  "http://127.0.0.1:8090/",
  "http://localhost:8090/api/",
  "http://[::1]:8090/",
  "http://0.0.0.0:8090/",
]) {
  const refused = await assertPublicUrl(url).then(
    () => false,
    () => true,
  );
  check(refused, `assertPublicUrl refuses ${url}`);
}

let canaryHits = 0;
const canary = createServer((_req, res) => {
  canaryHits++;
  res.end("SECRET");
});
await new Promise((r) => canary.listen(0, "127.0.0.1", r));
const canaryPort = canary.address().port;
const guard = await startGuardProxy();
const proxyUrl = new URL(guard.server);

const viaGuard = (method, path) =>
  new Promise((resolve) => {
    const req = httpRequest({ host: proxyUrl.hostname, port: proxyUrl.port, method, path });
    req.on("connect", (res) => resolve(`connected ${res.statusCode}`));
    req.on("response", (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve(`response ${res.statusCode} ${body}`));
    });
    req.on("error", () => resolve("refused"));
    req.end();
  });

check((await viaGuard("GET", `http://127.0.0.1:${canaryPort}/`)) === "refused", "guard proxy refuses plain HTTP to loopback");
check((await viaGuard("CONNECT", `127.0.0.1:${canaryPort}`)) === "refused", "guard proxy refuses CONNECT to loopback");
check((await viaGuard("CONNECT", `169.254.169.254:80`)) === "refused", "guard proxy refuses CONNECT to the metadata service");
check(canaryHits === 0, "loopback canary was never reached through the guard proxy");

await guard.close();
canary.close();

if (failures.length) {
  console.error("NETGUARD TEST FAILED");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("NETGUARD TEST PASSED");
