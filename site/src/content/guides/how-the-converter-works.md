---
title: How the site converter works
summary: What happens between pasting a URL and getting a content identifier back.
demo: site-converter
updated: 2026-09-30
order: 1
---

## Four steps, two programs

1. **Crawl.** A headless Chromium opens every page on the site, waits for it to finish rendering, and records every asset it loads. Menus that only open on hover are opened. Locale variants are discovered from the page's own hints.
2. **Rewrite.** Each page is saved as `route/index.html`, every link and asset reference is rewritten to point inside the copy, and attributes that would break on a different origin (subresource integrity, cross-origin flags) are removed. Sites that fetch their content from an API after loading get a small shim that replays the responses captured during the crawl, so the page does not go blank.
3. **Pack and upload.** filecoin-pin turns the folder into a content-addressed archive, stores it with a storage provider, and commits the piece on chain.
4. **Verify.** filecoin-pin waits for the provider to advertise the content to the IPFS indexers, then returns the root content identifier.

The result is served from a subdomain gateway, for example `https://<cid>.ipfs.inbrowser.link/`, because the copy keeps its links root-relative and needs `/` to be the site root.

## What to read next

- [filecoin-pin on GitHub](https://github.com/filecoin-project/filecoin-pin) for the upload half.
- [The IPFS gateway documentation](https://docs.ipfs.tech/concepts/ipfs-gateway/) for why the subdomain form matters.
- [docs.filecoin.io](https://docs.filecoin.io/) for the network itself.
