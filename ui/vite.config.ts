import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

// Dev-loop default for the in-process RRv7 server: the `/ui-server/*` resource routes
// fetch auth-proxy server-side via AUTH_PROXY_URL (app/lib/agent-client.ts). In
// dev that is the host-forwarded auth-proxy container at localhost:1042 — the same
// origin the `/api` + `/ui-state` proxies below target. Production runs the server
// build with a real injected env, so this default never applies there.
process.env.AUTH_PROXY_URL ??= "http://localhost:1042";

// RRv7 framework-mode SPA harness (Phase 0 — foamy-knitting-hennessy). The
// reactRouter() plugin takes over the document entry (app/root.tsx +
// app/entry.client.tsx), superseding the old index.html → src/main.js seam.
// Server settings preserved verbatim from the prior vite.config.js: port 5173,
// the /api → localhost:1042 auth-proxy proxy, and fs.allow for the monorepo root.
export default defineConfig({
  plugins: [reactRouter()],
  server: {
    // 5173 is the port the devcontainer forwards (.devcontainer/devcontainer.json).
    port: 5173,
    host: true,
    watch: {
      usePolling: true,
    },
    // react / react-dom (and now the hoisted react-router*) resolve from the
    // monorepo root node_modules (one level up), so allow Vite to serve from there.
    fs: { allow: [path.resolve(here, ".."), here] },
    proxy: {
      // Dev-login handshake (GET /api/auth/login, POST /api/auth/callback) plus
      // authenticated data fetches (e.g. GET /api/projects from metadataApiSource)
      // are forwarded to the auth-proxy compose container (host port 1042,
      // reachable inside this devcontainer at http://localhost:1042). Changing
      // this requires a dev-server restart (not HMR).
      "/api": { target: "http://localhost:1042", changeOrigin: true },
      // StateProxy wire surface (GET /ui-state/state, POST /ui-state/state/events,
      // GET /ui-state/state/stream SSE) — same auth-proxy container; without this
      // entry every /ui-state call 404s in the dev harness.
      "/ui-state": { target: "http://localhost:1042", changeOrigin: true },
    },
  },
});
