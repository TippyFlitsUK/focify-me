# focify.me

Paste a URL, get a static copy of that website stored on Filecoin Onchain
Cloud and served through IPFS gateways. A demo of dynamic-to-static site
conversion plus decentralised hosting.

focify.me is a personal, unofficial project. It is not affiliated with FilOz,
the Filecoin Foundation or Protocol Labs.

## How it works

```
browser ──POST /api/demo/start──▶ server.js (Express)
                                     │
                                     ├─ focify-clone <url> --out <dir>      crawl + rewrite (stderr progress, stdout JSON)
                                     ├─ filecoin-pin add <dir>               upload to FOC (stdout progress + result)
                                     └─ SSE ─▶ terminal view + result card (CID, gateway links, size, cost)
```

- [`focify-clone/`](focify-clone/) is the crawler: headless Chromium via
  Playwright, one `route/index.html` per page, all assets, a replay shim for
  hydrated frameworks. It has its own README, tests and CI.
- [`filecoin-pin`](https://github.com/filecoin-project/filecoin-pin) does the
  upload: packs the directory into a CAR, stores it with a storage provider,
  commits on chain and verifies IPNI indexing.
- `server.js` is the glue: job store, SSE streaming with reconnect, SQLite
  history, archive uploads.

## Run locally

```bash
npm install                       # server deps, including filecoin-pin
npm run build                     # builds focify-clone
npx --prefix focify-clone playwright install --with-deps chromium   # once
npm run dev                       # http://localhost:8090
```

Without credentials the crawl works and the upload step fails with a clear
message. To upload, create a calibnet session key with
`npx filecoin-pin login --network calibration` and point
`FOCIFY_CREDENTIALS_FILE` at the resulting dotenv file (SESSION_KEY and
WALLET_ADDRESS). The payer wallet needs at least 0.1 FIL plus USDFC.

## Configuration

All configuration is by environment variable. Secrets live in files that are
git-ignored and read by `ecosystem.config.cjs` at start.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 8090 | HTTP port |
| `FOCIFY_NETWORK` | calibration | `calibration` or `mainnet` |
| `FOCIFY_COPIES` | 1 | Storage copies per upload |
| `FOCIFY_PROVIDER_ID` | (auto) | Pin a storage provider id |
| `FOCIFY_MAX_PAGES` | 100 | Crawl page cap |
| `FOCIFY_CREDENTIALS_FILE` | (none) | dotenv file with `SESSION_KEY` and `WALLET_ADDRESS` |
| `FOCIFY_PROXY` | (none) | Residential HTTP proxy for challenge-protected sites |
| `FOCIFY_CLONE_CLI` | `focify-clone/dist/cli.js` | Override the crawler binary |
| `FILECOIN_PIN_CLI` | `node_modules/.bin/filecoin-pin` | Override the uploader binary |
| `FOCIFY_DB` | `focify.db` | SQLite job history |

## Deploy

The site runs under PM2 on a VPS behind Cloudflare. Deploy by rsync or scp,
then:

```bash
npm install && npm run build
pm2 delete focify-me; pm2 start ecosystem.config.cjs && pm2 save
```

`pm2 restart` keeps stale environment variables from its dump, so always
delete and start after changing `ecosystem.config.cjs`. Check with `pm2 env`.

## Endpoints

- `GET /` static frontend
- `POST /api/demo/start` `{ url }` or `{ file, originalName }`, returns `{ jobId }`
- `GET /api/demo/stream/:jobId` SSE progress, reconnects via `Last-Event-ID`
- `POST /api/upload` multipart archive upload (`.zip`, `.tar`, `.tar.gz`, `.tgz`, 500 MB max)
- `GET /api/stats`, `GET /api/jobs` job history

## Result links

The crawl keeps links root-relative, so the copy must be served with `/` as
the site root. Result links therefore use the subdomain gateway form
(`https://<cid>.ipfs.inbrowser.link/`, `https://<cid>.ipfs.dweb.link/`).
Path gateways (`/ipfs/<cid>/`) will not resolve internal links.
