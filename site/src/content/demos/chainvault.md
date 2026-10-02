---
title: "ChainVault: chain snapshots on Filecoin"
summary: Filecoin chain snapshots and the proof-parameter set archived on PDP storage providers, with proofs shown live and a node you can rehydrate on demand.
url: https://vault.ezpdpz.net/
source: https://github.com/TippyFlitsUK/chainvault-demo
owner: James Bluett
stack: [filecoin-pin, PDP, Forest, DuckDB WASM]
status: live
verified: 2026-09-17
category: archives
order: 2
---

A Python archiver stores Forest calibnet snapshots and the Filecoin proof parameters on storage providers through filecoin-pin, split into parts with a manifest. The site shows the on-chain proof status for every piece, streams parts back out, and can rehydrate a Forest node from what is stored.

The third tab loads a blockchain dataset straight from Filecoin into DuckDB in the browser and runs SQL over it, which is the part people tend to remember.
