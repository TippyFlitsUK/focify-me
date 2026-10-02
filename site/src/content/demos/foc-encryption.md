---
title: Client-side encryption demo
summary: Encrypt files in the browser, store them on Filecoin warm storage and share them with a link that only decrypts for someone holding the password.
url: https://github.com/Kubuxu/foc-encryption-demo#live-demo
source: https://github.com/Kubuxu/foc-encryption-demo
owner: Jakub Sztandera
stack: [synapse-sdk, COSE, AES-256-GCM, calibnet]
status: unverified
category: archives
order: 5
---

The live demo linked from the README did not load when checked on 2026-10-02: the viewer page and the encrypted file it opens were both unavailable. The link above goes to the README, which carries the demo link and the instructions to run it yourself.

Files are encrypted before they leave your machine. The viewer is a single page that fetches the encrypted file, asks for the password and decrypts in the browser, so no server sees the contents.
