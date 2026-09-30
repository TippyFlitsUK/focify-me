# focify-clone

Crawl a live website with a real browser and write a static copy that can be
pinned to IPFS or Filecoin. This is the cloner behind [focify.me](https://focify.me),
lifted out of `filecoin-nova` so it can be versioned and tested on its own.

focify.me is a personal, unofficial project. It is not affiliated with FilOz,
the Filecoin Foundation or Protocol Labs.

## What it does

1. Opens every same-origin page in headless Chromium (Playwright), so
   JavaScript-rendered and hydrated sites (Next.js, Nuxt, React, Astro) are
   captured after they finish rendering.
2. Downloads every asset the pages reference, including CSS `url()` fonts and
   images, `srcset` variants, inline `style` references and `<video>` sources.
3. Rewrites the HTML and CSS so the copy works as plain files, one
   `route/index.html` per page.
4. Captures cross-origin API responses made during the crawl and injects a
   small `fetch`/`XMLHttpRequest` shim that replays them, so frameworks that
   re-fetch data after hydration keep their content instead of blanking.
5. Strips `integrity`, `crossorigin` and `nonce` attributes, adds `muted` to
   autoplaying video, reveals hover-only navigation menus to discover links,
   and mirrors locale routes.

## Install

```bash
npm install
npx playwright install --with-deps chromium   # once per machine
npm run build
```

Requires Node 22 or newer.

## Usage

```
focify-clone <url> [options]

  --out <dir>          Output directory (default: ./<host>-<timestamp>/)
  --max-pages <n>      Max pages to crawl (default: 50, 0 = unlimited)
  --proxy <url>        HTTP proxy for challenge-protected sites
  --proxy-max-pages <n> Page cap used instead of --max-pages when the crawl
                       is routed through the proxy (default: same as --max-pages)
  --screenshots        Save before/after screenshots next to the output
```

Environment:

| Variable | Purpose |
|---|---|
| `FOCIFY_PROXY` | Residential HTTP proxy (`http://user:pass@host:port`). Used only when the target serves a Cloudflare or Vercel managed challenge. Datacenter proxies and stealth plugins do not pass those challenges. A proxied crawl sends every request through the proxy, so it is slow (about 35 s a page on operationbroadway.com) and bandwidth-metered; `--proxy-max-pages` bounds it without touching direct crawls. |
| `FOCIFY_CHROMIUM_PATH` | Use this Chromium binary instead of the one Playwright installed. |

## Output contract

This is the interface that focify.me's server depends on. Keep it stable.

- **stderr**: progress, one event per line, with ANSI colour codes. Shapes:
  - `[n/m] Step name`
  - `n/m https://example.com/page` (page progress)
  - `n/m /path/index.html` (rewrite progress)
  - `✔ message` on success, `✘ message` on failure
- **stdout**: exactly one JSON object on success:

  ```json
  {"directory":"/tmp/x","pages":12,"assets":140,"totalSize":1234567,"sourceUrl":"https://example.com","proxied":false}
  ```

- **exit codes**: `0` success, `1` crawl failed, `2` usage error, `3` the site
  is behind a security challenge and no proxy is configured.

## Gateway model

Links inside the copy are root-relative (`/about/`, `/assets/app.css`), the
same as the original site. That works when the copy is served with `/` as the
site root: subdomain IPFS gateways (`https://<cid>.ipfs.dweb.link/`,
`https://<cid>.ipfs.inbrowser.link/`), DNSLink hostnames and Cloudflare
Workers. It does not work on path gateways (`https://gateway/ipfs/<cid>/`),
where `/about/` would resolve to the gateway root. Build result links in the
subdomain form.

## Test

```bash
npm test
```

The smoke test serves a small fixture site on localhost (with a second origin
for its API and a third that fakes a Cloudflare challenge), crawls it, and
asserts the contract above: route layout, asset capture, attribute stripping,
the hydration shim, and the exit codes. It needs Chromium; on a machine
without Playwright's own build, point `FOCIFY_CHROMIUM_PATH` at one.

## Origin

The crawler was written for `filecoin-nova` (`src/clone.ts`) between March and
June 2026. It was extracted here in September 2026 when focify.me moved its
upload path to `filecoin-pin`. The only behaviour changes made during
extraction: the challenge probe now runs even without a proxy and exits 3
instead of capturing the interstitial, and `FOCIFY_CHROMIUM_PATH` was added.
