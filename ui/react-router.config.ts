import type { Config } from "@react-router/dev/config";

// SPA mode (ssr:false) — the prototype has no server runtime. This is the one
// deliberate divergence from frontend/ (which defaults to SSR). appDirectory
// "app" mirrors frontend/app/. Phase 0 walking skeleton (foamy-knitting-hennessy).
export default {
  ssr: false,
  appDirectory: "app",
} satisfies Config;
