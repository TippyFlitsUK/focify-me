module.exports = {
  apps: [{
    name: "focify-me",
    script: "server.js",
    cwd: "/home/tippyflits/focify-me",
    env: {
      NODE_ENV: "production",
      PORT: "80",
      NOVA_CLI: "/home/tippyflits/filecoin-nova/dist/cli.js",
    },
    max_memory_restart: "512M",
    node_args: "--max-old-space-size=512",
  }],
};
