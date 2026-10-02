---
title: Filecoin skills for agents
summary: Skills that let an AI agent store, share and verify data on Filecoin Onchain Cloud without a human in the loop.
url: https://github.com/filecoin-project/filecoin-skills
owner: Jennifer Wang
stack: [filecoin-pin, Filecoin Cloud console, session keys]
status: live
verified: 2026-09-22
category: agents
order: 6
---

Tell an agent "get me a shareable link for this folder" and these skills upload the folder to a storage provider, wait for the index to confirm it, verify the deal on chain and hand back a published link. The publish skill records what it shares so you can find it again later.
