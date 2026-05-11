import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
  },
});
