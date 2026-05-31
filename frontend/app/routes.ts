// RRv7 framework-mode route declarations — supersedes frontend/App.tsx's <Routes>.
// Path strings preserved byte-identically from App.tsx (DESIGN application-architecture.md §3.4).
// All 12 routes are library-mode at MR-0 (no `loader` exports); per-route migrations
// graduate individual modules into loader-bearing forms in subsequent MRs.
//
// Path resolution note: file paths in `route()`/`index()`/`layout()` are resolved
// relative to RRv7's `appDirectory` (defaults to `frontend/app/`), so the leading
// `app/` segment is omitted here — using `app/routes/...` would resolve to
// `frontend/app/app/routes/...` and fail with ENOENT at build time.
import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  // Test-only probe route — frontend-coexistence Phase 04 / DD-16. Dev-mode gated; 404 in production.
  route("/_test/loader-probe", "routes/_test-loader-probe.tsx"),
  route("/login", "routes/login.tsx"),
  route("/logout", "routes/logout.tsx"),
  route("/auth/callback", "routes/auth-callback.tsx"),
  route("/org/create", "routes/create-org.tsx"),
  layout("routes/app-shell.tsx", [
    // MR-4: the `/` index swaps from chat to the Pipeline landing (path-forward
    // §4.2). HomeRedirect resolves the org's default project and redirects to its
    // pipeline; chat is no longer a top-level page — it is the assistant overlay.
    // The standalone /chat/:channelId deep-link still maps to routes/chat.tsx.
    index("routes/home.tsx"),
    route("chat/:channelId", "routes/chat.tsx", { id: "chat-with-channel" }),
    route("projects", "routes/projects.tsx"),
    route("projects/:projectId", "routes/project-detail.tsx"),
    // MR-2: lineage Pipeline as the landing surface for a selected project
    // (path-forward §4.2). Additive — the chat `/` index + existing detail
    // routes are unchanged; the full index swap + chat-as-overlay is MR-4.
    route("projects/:projectId/pipeline", "routes/pipeline.tsx"),
    route(
      "projects/:projectId/datasets/:datasetId",
      "routes/project-detail.tsx",
      { id: "project-dataset-detail" },
    ),
    route("table/:datasetId", "routes/table.tsx"),
    route("view/:viewId", "routes/view-detail.tsx"),
    route("report/:reportId", "routes/report-detail.tsx"),
    route("query-engines", "routes/query-engines.tsx"),
    route("query-engines/:nodeId", "routes/query-engine-detail.tsx"),
    route("sessions", "routes/sessions.tsx"),
  ]),
] satisfies RouteConfig;
