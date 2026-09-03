# FOCify.ME

## Overview
Web frontend for Nova demo mode. Users enter a URL or upload an archive, the server runs `nova demo` and streams real-time progress via SSE with reconnect support. After deploy, optional ENS domain setup (register, update, or subdomain) inline on the page.

## Architecture
- **server.js** -- Express 5 server, spawns `npx filecoin-nova demo` as subprocess
- **public/index.html** -- Single-page frontend, SSE client, terminal-style progress display, inline ENS
- **public/ens/index.html** -- Standalone ENS page (register, update, subdomain)
- **public/fil-sign/index.html** -- Wallet authorization page via MetaMask on Filecoin
- **public/focify.png** -- Logo

## Endpoints
- `GET /` -- Static frontend
- `POST /api/demo/start` -- Start a demo job, returns `{ jobId }`
- `GET /api/demo/stream/:jobId` -- SSE stream of demo progress (supports reconnect via Last-Event-ID)
- `POST /api/upload` -- Multer file upload, returns `{ path, originalName }`

## SSE Reconnect
Server stores all events per job with incrementing IDs. On reconnect, EventSource sends `Last-Event-ID` header and server replays all missed events. Jobs live for 10 minutes after completion for reconnect support.

## Deployment
- Server: 77.42.75.71 (filoz-dealbot)
- Directory: ~/focify-me/
- Port: 80 (Cloudflare proxies HTTPS -> HTTP)
- PM2: `focify-me` with `kill_timeout: 600000` (10 min graceful shutdown)
- Domain: focify.me + www.focify.me
- Runs nova via `npx -y --package filecoin-nova@latest nova` on every job, so new npm releases are picked up automatically; `filecoin-nova` is not a package.json dependency. `NOVA_CLI` in the PM2 env overrides this with a local build.

## Cloudflare DNS
- Zone: focify.me
- Zone ID: `732b0d8db7d024a77ae0794f01fbd7e7`
- API Token: `W5qF7VaIGf1DCj8IksinyFR87bGaT-T_VzPX4bk-`

## Dependencies
- express 5 -- HTTP server + static files
- multer 2 -- File upload handling
- filecoin-nova -- Spawned as subprocess via npx

## Dev
```bash
npm install
npm run dev    # node --watch server.js
```

## Concurrency
- Max 25 concurrent demo jobs
- No subprocess timeout -- jobs run until completion
- Graceful shutdown: SIGTERM drains in-flight jobs before exiting
- Client disconnect does NOT kill subprocess (job continues for reconnect)

## npx Caching
- `npx -y --package filecoin-nova` caches the first-downloaded version and never re-resolves from registry
- MUST use `--package filecoin-nova@latest` to force registry check on every run
- To manually clear: `rm -rf ~/.npm/_npx/*` then `npm cache clean --force`

## PM2 Environment Gotchas
- `pm2 restart` preserves env vars from the PM2 dump (~/.pm2/dump.pm2) -- even deleted env vars persist
- Only `pm2 delete <app> && pm2 start ecosystem.config.cjs && pm2 save` clears stale env vars
- Check current env with `pm2 env <id>` -- look for stale vars like NOVA_CLI
- NOVA_CLI env var overrides npx and uses a local build -- if set, npx path is never used
