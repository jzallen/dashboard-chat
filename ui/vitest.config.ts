import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest runs with @vitejs/plugin-react, NOT the reactRouter() Vite plugin used
// for dev/build (vite.config.ts). The RR plugin injects a React-refresh preamble
// the test runtime can't satisfy ("can't detect preamble"), so framework-mode
// route modules can only be unit/integration-tested under plain plugin-react —
// the same split frontend/ uses (frontend/vitest.config.ts).
export default defineConfig({
  // Cast: vitest bundles its own vite with slightly different plugin types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
