import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Cast needed due to vitest bundling its own vite with different types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest bundles its own vite with different types
  plugins: [react() as any],
  resolve: {
    alias: {
      "@/toolCalls": path.resolve(__dirname, "src/core/toolCalls"),
      "@/chat": path.resolve(__dirname, "src/core/chat"),
      "@/queryTranslation": path.resolve(__dirname, "src/lib/queryTranslation"),
      "@/dataCatalog": path.resolve(__dirname, "src/core/dataCatalog"),
      "@/http": path.resolve(__dirname, "src/lib/http"),
      "@/auth": path.resolve(__dirname, "src/core/auth"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
