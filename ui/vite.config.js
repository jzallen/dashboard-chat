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
    port: 5174,
    host: true,
    // react / react-dom are resolved from the monorepo root node_modules
    // (one level up), so allow Vite to serve from there.
    fs: { allow: [path.resolve(here, ".."), here] },
  },
});
