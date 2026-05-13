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
    index("routes/chat.tsx"),
    route("chat/:channelId", "routes/chat.tsx", { id: "chat-with-channel" }),
    route("projects", "routes/projects.tsx"),
    route("projects/:projectId", "routes/project-detail.tsx"),
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
