// PM2 configuration for focify.me.
//
// Secrets never live in this file or in git. Two optional files next to the
// app, both chmod 600, are read at start:
//   .focify_proxy        one line: http://user:pass@host:port (residential
//                        proxy used only for challenge-protected sites)
//   .focify_credentials  optional dotenv-style SESSION_KEY / WALLET_ADDRESS
//                        for filecoin-pin (passed via --credentials-file).
//                        Not needed after `filecoin-pin login`: the saved
//                        session in ~/.local/share/filecoin-pin is used.
//
// After changing env here: pm2 delete focify-me && pm2 start ecosystem.config.cjs && pm2 save
// (pm2 restart keeps stale env vars from the dump).

const fs = require("fs");
const path = require("path");

const APP_DIR = "/home/tippyflits/focify-me";

function readOptional(file) {
  try {
    return fs.readFileSync(path.join(APP_DIR, file), "utf8").trim();
  } catch {
    return "";
  }
}

const proxy = readOptional(".focify_proxy");
const credentialsFile = fs.existsSync(path.join(APP_DIR, ".focify_credentials"))
  ? path.join(APP_DIR, ".focify_credentials")
  : "";

module.exports = {
  apps: [{
    name: "focify-me",
    script: "server.js",
    cwd: APP_DIR,
    env: {
      NODE_ENV: "production",
      PORT: "80",
      FOCIFY_NETWORK: "calibration",
      FOCIFY_COPIES: "1",
      FOCIFY_PROVIDER_ID: "9",
      FOCIFY_MAX_PAGES: "100",
      ...(proxy ? { FOCIFY_PROXY: proxy } : {}),
      ...(credentialsFile ? { FOCIFY_CREDENTIALS_FILE: credentialsFile } : {}),
    },
    kill_timeout: 600000,
    max_memory_restart: "512M",
    node_args: "--max-old-space-size=512",
  }],
};
