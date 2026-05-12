import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    // Suppress the production composition-root from binding to a real port
    // when index.ts is imported by `index.test.ts`. The autostart guard in
    // index.ts respects this env var.
    env: {
      UI_STATE_AUTOSTART: "false",
    },
  },
});
