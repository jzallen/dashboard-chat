import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    globals: false,
  },
});
