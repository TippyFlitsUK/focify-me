---
title: Publish a static site to Filecoin
summary: The same steps this site uses to publish itself, with filecoin-pin and a GitHub Action.
updated: 2026-09-30
order: 2
---

This site is a static build pinned to Filecoin Onchain Cloud on every change. The whole pipeline is a build step, a link check and one command.

## Once: log in

```bash
npx filecoin-pin login
```

That creates a session key on your machine and asks you to approve it in the Filecoin Cloud console. The session key can add data but cannot move funds. Deposit some USDFC in the console to pay for storage.

## Every change: build and add

```bash
npm run build
npx filecoin-pin add dist --copies 2
```

filecoin-pin packs the folder, stores it with two providers, commits on chain and prints the root content identifier. Open it at `https://<cid>.ipfs.dweb.link/`.

## In CI

Put `SESSION_KEY` and `WALLET_ADDRESS` in the repository secrets and run the same two commands from a workflow. This repository's `.github/workflows/site.yml` is a working example.

## Where the real documentation is

- [filecoin-pin README](https://github.com/filecoin-project/filecoin-pin)
- [Filecoin Onchain Cloud docs](https://docs.filecoin.cloud/)
