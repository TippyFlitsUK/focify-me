module.exports = {
  apps: [{
    name: "focify-me",
    script: "server.js",
    cwd: "/home/tippyflits/focify-me",
    env: {
      NODE_ENV: "production",
      PORT: "80",
    },
    kill_timeout: 600000,
    max_memory_restart: "512M",
    node_args: "--max-old-space-size=512",
  }],
};
