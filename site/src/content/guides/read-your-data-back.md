---
title: Read your data back
summary: The three ways to open something stored on Filecoin Onchain Cloud, and when each one works.
updated: 2026-09-30
order: 3
---

Everything on Filecoin Onchain Cloud is content-addressed. When you upload with filecoin-pin you get two identifiers back, and each opens a different door.

## The root CID: open it like a website

The root CID (`bafybei…`) is the IPFS identifier for your folder. Any IPFS gateway can serve it, as long as the storage provider has advertised it to the indexers, which filecoin-pin waits for before it reports success.

Two gateway shapes exist and they are not interchangeable:

- **Subdomain form**, `https://<cid>.ipfs.dweb.link/` or `https://<cid>.ipfs.inbrowser.link/`. Your site is the origin, so root-relative links like `/about/` work. Use this for websites.
- **Path form**, `https://gateway/ipfs/<cid>/`. Every site shares the gateway's origin, so `/about/` points at the gateway root and breaks. Fine for single files, wrong for sites.

Public gateways rate-limit automated traffic. For anything beyond a demo, run your own gateway or use a CDN that fetches from the providers.

## The piece CID: fetch the raw archive from the provider

The piece CID (`bafkzcib…`) names the exact bytes the provider proves it holds. filecoin-pin prints a retrieval URL for it: a direct download of the CAR archive from the provider, no IPFS indexing involved. This is the path that always works if the provider is up, and the one to use when you want to verify what is stored rather than browse it.

## Through the SDK

`synapse.storage.download({ pieceCid })` in the [Synapse SDK](https://github.com/FilOzone/synapse-sdk) tries every provider that holds the piece and returns the bytes. That is what applications use.

## Further reading

- [filecoin-pin retrieval guide](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/retrieval.md)
- [IPFS gateway concepts](https://docs.ipfs.tech/concepts/ipfs-gateway/)
