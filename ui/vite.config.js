import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, transformWithEsbuild } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

// ─── prototype-bundle plugin ─────────────────────────────────────────────────
// The Claude Design prototype (src/app/*) is a set of Babel-standalone
// CLASSIC scripts that share ONE global scope: each file's top-level
// `function`/`const` become globals, files reference each other by bare name,
// and React / ReactDOM / DC are globals. A bundler scopes every module
// separately, which would break all those cross-file references.
//
// So we reproduce the original execution model: concatenate the files in the
// exact order the prototype's HTML loaded them into a SINGLE module (one shared
// scope), prepend the React/ReactDOM globals the scripts assume, and let esbuild
// transpile the JSX. `data.js` assigns `window.DC`, so bare `DC` resolves; app.jsx
// ends with `ReactDOM.createRoot(...).render(<App/>)`, so importing the bundle
// mounts the app.
//
// This is deliberately a TEMPORARY harness. As we refactor the prototype into
// real ESM modules (proper imports/exports), files drop out of PROTO_FILES and
// this plugin shrinks until it can be deleted.
const PROTO_FILES = [
  "data.js",
  "tweaks-panel.jsx",
  "ui.jsx",
  "lineage.jsx",
  "detail.jsx",
  "chat.jsx",
  "upload.jsx",
  "app.jsx",
];
const VIRTUAL_ID = "virtual:prototype";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const PROTO_DIR = path.join(here, "src", "app");

function prototypeBundle() {
  return {
    name: "prototype-bundle",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      const preamble =
        "import React from 'react';\n" +
        "import * as ReactDOM from 'react-dom/client';\n" +
        "globalThis.React = React;\n" +
        "globalThis.ReactDOM = ReactDOM;\n";
      const body = PROTO_FILES.map(
        (f) =>
          `\n/* ───────── ${f} ───────── */\n` +
          readFileSync(path.join(PROTO_DIR, f), "utf8"),
      ).join("\n");
      const out = await transformWithEsbuild(preamble + body, "prototype.jsx", {
        loader: "jsx",
      });
      return { code: out.code, map: out.map };
    },
    handleHotUpdate(ctx) {
      // Any edit to a prototype source file rebuilds the concatenated module.
      if (ctx.file.startsWith(PROTO_DIR)) {
        const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
        ctx.server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [prototypeBundle()],
  server: {
    port: 5174,
    host: true,
    // react / react-dom are resolved from the monorepo root node_modules
    // (one level up), so allow Vite to serve from there.
    fs: { allow: [path.resolve(here, ".."), here] },
  },
});
