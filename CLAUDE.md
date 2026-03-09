# FOCify.ME

## Overview
Web frontend for Nova demo mode. Users enter a URL or upload an archive, the server runs `nova demo` and streams real-time progress via SSE with reconnect support. After deploy, optional ENS domain setup (register, update, or subdomain) inline on the page.

## Architecture
- **server.js** -- Express 5 server, spawns `npx filecoin-nova demo` as subprocess
- **public/index.html** -- Single-page frontend, SSE client, terminal-style progress display, inline ENS
- **public/ens.html** -- Standalone ENS page (register, update, subdomain)
- **public/session.html** -- Session key creation via MetaMask on Filecoin
- **public/fil-sign.html** -- Generic Filecoin transaction signing via MetaMask
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
- Uses published `filecoin-nova` npm package via npx (no local build)

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
- Max 10 concurrent demo jobs
- Subprocess timeout: 10 minutes (prevents hung jobs blocking slots)
- Graceful shutdown: SIGTERM drains in-flight jobs before exiting
- Client disconnect does NOT kill subprocess (job continues for reconnect)
