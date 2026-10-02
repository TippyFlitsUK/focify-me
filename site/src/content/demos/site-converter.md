---
title: Site converter
summary: Paste a URL, get a static copy of that website stored on Filecoin and served from IPFS gateways.
url: https://focify.me/demo/
source: https://github.com/TippyFlitsUK/focify-me
owner: James Bluett
stack: [Playwright, filecoin-pin, Filecoin Onchain Cloud, calibnet]
status: live
verified: 2026-09-30
category: websites
order: 1
---

The converter crawls a live website with a real browser, rewrites it into plain files, and uploads the result with filecoin-pin. You watch every step in a terminal view and end up with a content identifier and a gateway link.

It runs on the calibration testnet so it is free to use. The storage cost it shows is what the same site would cost on mainnet.

What it is good at: marketing sites, blogs, documentation, and hydrated framework sites (Next.js, Nuxt) whose content is fetched from an API after load. What it will not do: anything behind a login, infinite feeds, or sites behind a security challenge.
