// Vitest config for the UserFlowHarness unit-level verification (Step 02-02).
//
// The Cucumber suite remains the canonical acceptance driver and is fully
// independent of this config (cucumber.cjs only loads features/**/*.feature
// and steps/**/*.ts). These vitest tests target the harness module itself
// at unit scope using undici MockAgent to fake the auth-proxy responses.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["harness/**/*.test.ts"],
    exclude: ["node_modules", "dist", "features", "steps"],
    environment: "node",
  },
});
