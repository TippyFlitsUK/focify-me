---
title: Verifiable records for real-world assets
summary: Verifiable offchain records for tokenized real-world assets on Avalanche, with IPFS CIDs and Filecoin storage proofs.
url: https://sgtpooki.github.io/Avalanche-IPFS-Filecoin-RWA-reference-Architecture/
source: https://github.com/sgtpooki/Avalanche-IPFS-Filecoin-RWA-reference-Architecture
owner: Russell Dempsey
stack: [Avalanche Fuji, IPFS, Filecoin Onchain Cloud, calibnet]
status: live
verified: 2026-10-02
category: archives
order: 3
---

A reference architecture with a working example: a property record whose deed, survey and tax assessment are stored on Filecoin, with a pointer to them recorded on Avalanche.

Press "Verify now" and the page reads the pointer, fetches each document from a storage provider, checks that the bytes match their content identifiers and checks that the storage proofs are up to date. No wallet is needed. You can also drop in an edited copy of the deed and watch it fail the check.
