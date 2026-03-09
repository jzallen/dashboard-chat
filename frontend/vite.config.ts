import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    watch: {
      usePolling: true,
    },
    hmr: {
      clientPort: 5173,
    },
    proxy: {
      "/api": {
        target: "http://api:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://api:8000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/toolCalls": path.resolve(__dirname, "src/core/toolCalls"),
      "@/chat": path.resolve(__dirname, "src/core/chat"),
      "@/queryTranslation": path.resolve(__dirname, "src/lib/queryTranslation"),
      "@/dataCatalog": path.resolve(__dirname, "src/core/dataCatalog"),
      "@/http": path.resolve(__dirname, "src/lib/http"),
      "@/auth": path.resolve(__dirname, "src/core/auth"),
      "@/stream": path.resolve(__dirname, "src/lib/stream"),
    },
  },
});
