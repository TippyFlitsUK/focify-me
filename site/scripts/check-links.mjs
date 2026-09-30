// Link checker for the built site. Internal links must resolve to a file in
// dist. External links are HEAD-checked when CHECK_EXTERNAL=1 (CI), because
// the point of the gallery is that nothing on it is allowed to rot quietly.
// Usage: node scripts/check-links.mjs dist
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = resolve(process.argv[2] || "dist");
const checkExternal = process.env.CHECK_EXTERNAL === "1";
// Routes served by the demo runner (server.js behind nginx), not by this build.
const runnerPrefixes = ["demo/", "api/"];

const htmlFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".html")) htmlFiles.push(p);
  }
})(root);

const attrRe = /(?:href|src)=["']([^"'#?]+)[^"']*["']/g;
const internalFailures = [];
const external = new Map(); // url -> [pages]

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(attrRe)) {
    const target = m[1];
    if (/^(mailto:|tel:|data:|javascript:)/.test(target)) continue;
    if (/^https?:\/\//.test(target)) {
      if (!external.has(target)) external.set(target, []);
      external.get(target).push(file.slice(root.length + 1));
      continue;
    }
    // Internal: resolve relative to the page, then to a file or a dir index.
    const base = target.startsWith("/") ? root : dirname(file);
    let p = resolve(base, target.startsWith("/") ? "." + target : target);
    const rel = p.startsWith(root) ? p.slice(root.length + 1) : p;
    if (runnerPrefixes.some((pre) => rel === pre.slice(0, -1) || rel.startsWith(pre))) continue;
    const candidates = [p, join(p, "index.html")];
    if (!candidates.some((c) => existsSync(c) && statSync(c).isFile())) {
      internalFailures.push(`${file.slice(root.length + 1)} -> ${target}`);
    }
  }
}

let externalFailures = [];
if (checkExternal) {
  const results = await Promise.all(
    [...external.keys()].map(async (url) => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 15000);
        let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
        if (res.status === 405 || res.status === 403) {
          res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
        }
        clearTimeout(t);
        return res.ok ? null : `${url} -> HTTP ${res.status} (on ${external.get(url).join(", ")})`;
      } catch (err) {
        return `${url} -> ${err.name === "AbortError" ? "timeout" : err.message} (on ${external.get(url).join(", ")})`;
      }
    }),
  );
  externalFailures = results.filter(Boolean);
}

console.log(`${htmlFiles.length} pages, ${external.size} external links${checkExternal ? " checked" : " (not checked, set CHECK_EXTERNAL=1)"}`);
if (internalFailures.length || externalFailures.length) {
  for (const f of internalFailures) console.error("BROKEN internal: " + f);
  for (const f of externalFailures) console.error("BROKEN external: " + f);
  process.exit(1);
}
console.log("All links OK");
