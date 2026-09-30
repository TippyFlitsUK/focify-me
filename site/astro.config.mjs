import { defineConfig } from "astro/config";

// Static output only: the site is pinned to Filecoin Onchain Cloud and served
// from IPFS gateways, so every route must be a real file and links relative.
export default defineConfig({
  site: "https://focify.me",
  output: "static",
  build: { format: "directory" },
  trailingSlash: "always",
});
