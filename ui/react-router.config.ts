import type { Config } from "@react-router/dev/config";

// Server runtime ENABLED (ssr:true) — the first step of the SSR-as-ui-server progression
// (docs/feature/ssr-ui-server-gateway). A server runtime is the prerequisite for the
// server-side `/ui-server/*` resource routes that broker the live agent SSE; it also
// lets ui/ eventually take over frontend/'s web-ssr role.
//
// SSR-safety: the app's interactive tree is intentionally client-only. `root.tsx`
// pairs a `clientLoader` (initCatalog) with a null `HydrateFallback`, so on the
// server only the document `Layout` + the fallback render — the provider tree
// (StateProxy/EventSource, the module-level `catalog` reads) never executes
// server-side and hydrates on the client. The `/ui-server/*` resource routes carry no
// React and run purely server-side. appDirectory "app" mirrors frontend/app/.
export default {
  ssr: true,
  appDirectory: "app",
} satisfies Config;
