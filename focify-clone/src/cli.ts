#!/usr/bin/env node
// focify-clone: crawl a live website with a real browser and write a static,
// IPFS-ready copy (one index.html per route, relative links, all assets).
//
// Output contract (relied on by focify-me/server.js):
//   stderr  progress lines, one per event
//   stdout  exactly one JSON object on success
//   exit    0 success, 1 crawl failed, 2 usage error, 3 blocked by a security
//           challenge and no FOCIFY_PROXY / --proxy configured

import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { c, fail, info, isUrl } from "./ui.js";

// Progress goes to stderr; stdout is reserved for the JSON result.
const toStderr = (...args: unknown[]) => {
  process.stderr.write(args.map(String).join(" ") + "\n");
};
console.log = toStderr;
console.error = toStderr;

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function usage() {
  toStderr(`
  ${c.cyan}${c.bold}focify-clone${c.reset} ${c.dim}v${version} - static copy of a live website${c.reset}

  ${c.bold}Usage${c.reset}

    ${c.cyan}focify-clone${c.reset} <url> [options]

  ${c.bold}Options${c.reset}

    ${c.dim}--out <dir>${c.reset}          Output directory (default: ./<host>-<timestamp>/)
    ${c.dim}--max-pages <n>${c.reset}      Max pages to crawl (default: 50, 0 = unlimited)
    ${c.dim}--proxy <url>${c.reset}        HTTP proxy for challenge-protected sites
                         (same as FOCIFY_PROXY, e.g. http://user:pass@host:port)
    ${c.dim}--screenshots${c.reset}        Save before/after screenshots next to the output
    ${c.dim}--version${c.reset}            Print the version
    ${c.dim}--help${c.reset}               Show this help

  ${c.bold}Environment${c.reset}

    FOCIFY_PROXY          Residential HTTP proxy used only when the target
                          serves a Cloudflare or Vercel challenge
    FOCIFY_CHROMIUM_PATH  Use this Chromium binary instead of Playwright's

  ${c.bold}Output${c.reset}

    stderr: progress lines. stdout: one JSON object, e.g.
    {"directory":"/tmp/x","pages":12,"assets":140,"totalSize":1234567,"sourceUrl":"https://example.com"}
`);
}

async function main(): Promise<number> {
  let values: {
    out?: string;
    output?: string;
    "max-pages"?: string;
    proxy?: string;
    screenshots?: boolean;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      options: {
        out: { type: "string" },
        output: { type: "string" },
        "max-pages": { type: "string" },
        proxy: { type: "string" },
        screenshots: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "V", default: false },
      },
      allowPositionals: true,
    }));
  } catch (err: any) {
    fail(err.message);
    usage();
    return 2;
  }

  if (values.version) {
    process.stdout.write(version + "\n");
    return 0;
  }
  if (values.help) {
    usage();
    return 0;
  }

  let url = positionals[0];
  if (!url) {
    fail("URL argument required.");
    usage();
    return 2;
  }
  if (!isUrl(url)) {
    fail(`Not a URL: ${url}`);
    return 2;
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    new URL(url);
  } catch {
    fail(`Invalid URL: ${url}`);
    return 2;
  }

  let maxPages: number | undefined;
  if (values["max-pages"] !== undefined) {
    const n = Number(values["max-pages"]);
    if (!Number.isInteger(n) || n < 0) {
      fail(`Invalid --max-pages: ${values["max-pages"]}`);
      return 2;
    }
    maxPages = n;
  }

  if (values.proxy) process.env.FOCIFY_PROXY = values.proxy;

  const output = values.out ?? values.output;

  info(`Cloning ${url}`);
  if (maxPages !== undefined) info(`Max pages: ${maxPages === 0 ? "unlimited" : maxPages}`);

  const { clone, ChallengeBlockedError } = await import("./clone.js");
  try {
    const result = await clone({ url, output, maxPages, screenshots: values.screenshots === true });
    process.stdout.write(
      JSON.stringify({
        directory: result.directory,
        pages: result.pages,
        assets: result.assets,
        totalSize: result.totalSize,
        sourceUrl: result.sourceUrl,
      }) + "\n",
    );
    return 0;
  } catch (err: any) {
    if (err instanceof ChallengeBlockedError) {
      fail(err.message);
      return 3;
    }
    fail(err?.message || String(err));
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    fail(err?.message || String(err));
    process.exit(1);
  },
);
