---
title: FOC-CADE
summary: Multiplayer games, a chat, a paint canvas, a jukebox and a tamagotchi with Filecoin Onchain Cloud as the only backend. No server anywhere.
url: https://sgtpooki.github.io/foc-collab/
source: https://github.com/sgtpooki/foc-collab
owner: Russell Dempsey
stack: [Filecoin Onchain Cloud, session keys, Filecoin Pay, calibnet]
status: live
verified: 2026-10-02
category: websites
order: 2
---

An arcade that runs entirely in the browser. Every move, chat message and painted pixel is a small signed file stored in a data set, and each page rebuilds the game by reading those files back in order. There is no database and no server to take down.

Some games need a wallet on the calibration testnet. The paint canvas and the chat work without one, and anyone with a link can watch a game.
