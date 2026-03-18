import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
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
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/core/chat/**/*.test.{ts,tsx}"],
    pool: "threads",
    isolate: false,
    fileParallelism: false,
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
        },
      },
    },
  },
});
