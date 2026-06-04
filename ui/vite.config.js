import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

// The app is now a regular ESM tree: src/main.js imports the global CSS and
// src/app/app.tsx, which imports every feature package and calls createRoot.
// (The prototype-bundle harness that concatenated the classic src/app/*.jsx
// files into one shared-scope module has been removed now that the migration
// to real modules is complete.)
export default defineConfig({
  root: here,
  server: {
    // 5173 is the port the devcontainer forwards (.devcontainer/devcontainer.json).
    port: 5173,
    host: true,
    // react / react-dom are resolved from the monorepo root node_modules
    // (one level up), so allow Vite to serve from there.
    fs: { allow: [path.resolve(here, ".."), here] },
    proxy: {
      // Dev-login handshake (GET /api/auth/login, POST /api/auth/callback) is
      // forwarded to the auth-proxy. Resolved address: the auth-proxy compose
      // container publishes host port 1042 (docker-compose.yml), which is
      // reachable from inside this devcontainer at http://localhost:1042
      // (verified with curl). Run it in dev mode so the login url points back
      // at this app: `AUTH_MODE=dev docker compose up -d auth-proxy api redis`.
      "/api/auth": { target: "http://localhost:1042", changeOrigin: true },
      // Future backend-data step: proxy the rest of /api to the same gateway so
      // authenticated fetches replay the Bearer token through auth-proxy. Left
      // commented until the ui/ app actually fetches real data (out of scope
      // here — the app still renders on fixtures after login).
      // "/api": { target: "http://localhost:1042", changeOrigin: true },
    },
  },
});
