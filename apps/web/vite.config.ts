import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API port is pinned in scripts/dev.ts.
    proxy: {
      "/api": "http://localhost:4100",
      // Each business's MCP server, /<slug>/mcp.
      "^/[^/]+/mcp$": "http://localhost:4100",
    },
  },
});
