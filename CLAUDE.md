# FOCify.ME

## Overview
Web frontend for Nova demo mode. Users enter a URL or upload an archive, the server runs `nova demo` and streams real-time progress via SSE. After deploy, optional ENS pointing via ens.focify.eth.limo.

## Architecture
- **server.js** -- Express 5 server, spawns `npx filecoin-nova demo` as subprocess
- **public/index.html** -- Single-page frontend, SSE client, terminal-style progress display
- **public/focify.png** -- Logo

## Endpoints
- `GET /` -- Static frontend
- `GET /api/demo/stream?url=<url>` -- SSE stream of nova demo progress (URL mode)
- `GET /api/demo/stream?file=<path>` -- SSE stream of nova demo progress (uploaded archive)
- `POST /api/upload` -- Multer file upload, returns `{ path, originalName }`

## Deployment
- Server: 77.42.75.71 (filoz-dealbot)
- Directory: ~/focify-me/
- Port: 80 (Cloudflare proxies HTTPS -> HTTP)
- PM2: `focify-me`
- Domain: focify.me + www.focify.me

## Cloudflare DNS
- Zone: focify.me
- Zone ID: `732b0d8db7d024a77ae0794f01fbd7e7`
- API Token: `W5qF7VaIGf1DCj8IksinyFR87bGaT-T_VzPX4bk-`

## Dependencies
- express 5 -- HTTP server + static files
- multer 2 -- File upload handling
- filecoin-nova -- Spawned as subprocess via `NOVA_CLI` env var (local build) or npx (published)

## TODO
- **Switch to published npm:** Once filecoin-nova is published with demo/clone commands, remove `NOVA_CLI` from ecosystem.config.cjs. The server falls back to `npx -y --package filecoin-nova nova` automatically.

## Dev
```bash
npm install
npm run dev    # node --watch server.js
```

## Concurrency
- Max 3 concurrent demo jobs (clone is CPU/memory intensive with Playwright)
- SSE connection cleaned up on client disconnect (kills subprocess)
