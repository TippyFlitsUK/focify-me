// Smoke test: serve the fixture site on localhost (plus a second origin for
// its API), crawl it with the built CLI, and assert the output contract.
// Run with: npm test   (set FOCIFY_CHROMIUM_PATH if Playwright's own
// Chromium is not installed).
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixture");
const cli = join(here, "..", "dist", "cli.js");
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

function listen(server) {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
}

// Second origin: the "API" the fixture's app.js fetches after load.
const api = createServer((req, res) => {
  if (new URL(req.url, "http://x").pathname === "/api/data.json") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(readFileSync(join(fixture, "api", "data.json")));
  } else {
    res.writeHead(404).end();
  }
});
const apiOrigin = await listen(api);

// Main origin: the fixture site. app.js gets the API origin substituted in.
const site = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  if (path.startsWith("/api/")) {
    res.writeHead(404).end();
    return;
  }
  const file = join(fixture, path);
  if (!file.startsWith(fixture) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  if (path === "/assets/app.js") {
    res.end(readFileSync(file, "utf8").replace("__API_ORIGIN__", apiOrigin));
  } else {
    res.end(readFileSync(file));
  }
});
const origin = await listen(site);

// Third origin: a fake Cloudflare challenge page, to check exit code 3.
const challenge = createServer((_req, res) => {
  res.writeHead(403, { "content-type": "text/html", "cf-mitigated": "challenge" });
  res.end("<html><head><title>Just a moment...</title></head><body>cf_chl</body></html>");
});
const challengeOrigin = await listen(challenge);

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", FOCIFY_PROXY: "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const out = mkdtempSync(join(tmpdir(), "focify-clone-smoke-"));
const main = await run([origin, "--out", out, "--max-pages", "10"]);
const blocked = await run([challengeOrigin, "--out", join(out, "blocked")]);
api.close();
site.close();
challenge.close();

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// Process contract
check(main.code === 0, `exit code ${main.code}`);
let result = null;
try {
  result = JSON.parse(main.stdout.trim());
} catch {
  failures.push("stdout is not a single JSON object");
}
check(result && result.directory === out, "result.directory matches --out");
check(result && result.pages === 3, `crawled 3 pages (got ${result && result.pages})`);
const lines = stripAnsi(main.stderr).split("\n").map((l) => l.trim()).filter(Boolean);
check(lines.some((l) => /^\[\d+\/\d+\]\s/.test(l)), "stderr has [n/m] step lines");
check(lines.some((l) => /^\d+\/\d+\s+https?:\/\//.test(l)), "stderr has n/m <url> page progress lines");
check(lines.some((l) => l.startsWith("✔")), "stderr has a ✔ success line");
check(blocked.code === 3, `challenge-protected site without a proxy exits 3 (got ${blocked.code})`);
check(/security challenge/i.test(stripAnsi(blocked.stderr)), "challenge exit explains itself on stderr");

// Output layout
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(out);
const rel = (p) => p.slice(out.length + 1);
for (const route of ["index.html", "about/index.html", "blog/post-1/index.html"]) {
  check(existsSync(join(out, route)), `route file ${route} exists`);
}
for (const asset of ["site.css", "app.js", "hero-400.png", "hero-800.png", "bg.png", "fx.woff2", "clip.mp4"]) {
  check(files.some((f) => f.endsWith("/" + asset)), `asset ${asset} downloaded`);
}

// Rewriting. clone.ts keeps links root-relative (subdomain-gateway model), so
// the checks are: no attribute still points at the crawl origin, and nothing
// still points at the API origin (the shim replays it instead).
const attrWithOrigin = new RegExp(`(href|src|srcset|poster|action)=["'][^"']*${origin.replace(/[.:/]/g, "\\$&")}`);
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  check(!attrWithOrigin.test(html), `${rel(f)}: no attribute still points at the crawl origin`);
  check(!/\bintegrity=/.test(html), `${rel(f)}: integrity attribute stripped`);
  check(!/<link[^>]*\bcrossorigin=/.test(html), `${rel(f)}: crossorigin stripped from <link>`);
  check(!/\bnova\b/i.test(html), `${rel(f)}: no Nova identifiers`);
}
const home = readFileSync(join(out, "index.html"), "utf8");
check(/<video[^>]*\bmuted\b/.test(home), "autoplay video has muted attribute");
check(
  home.includes("window.fetch=function()") && home.includes("getAllResponseHeaders=function()"),
  "hydration API cache shim (fetch + XHR patch) injected for the cross-origin fetch",
);
check(home.includes(apiOrigin + "/api/data.json"), "shim cache is keyed by the cross-origin API URL");
check(home.includes("alpha") && home.includes("gamma"), "captured cross-origin API response is embedded in the shim");
const css = readFileSync(files.find((f) => f.endsWith("site.css")), "utf8");
check(!/url\(["']?\//.test(css), "site.css url() references are relative");
check(!css.includes(origin), "site.css has no absolute crawl origin");

if (failures.length) {
  console.error("SMOKE TEST FAILED");
  for (const f of failures) console.error("  - " + f);
  console.error("\n--- focify-clone stderr (main run) ---\n" + stripAnsi(main.stderr));
  console.error("--- stdout ---\n" + main.stdout);
  console.error("--- focify-clone stderr (challenge run) ---\n" + stripAnsi(blocked.stderr));
  process.exit(1);
}
console.log(`SMOKE TEST PASSED (${files.length} files, ${result.pages} pages, ${result.assets} assets)`);
rmSync(out, { recursive: true, force: true });
