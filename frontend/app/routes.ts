// RRv7 framework-mode route declarations — supersedes frontend/App.tsx's <Routes>.
// Path strings preserved byte-identically from App.tsx (DESIGN application-architecture.md §3.4).
// All 12 routes are library-mode at MR-0 (no `loader` exports); per-route migrations
// graduate individual modules into loader-bearing forms in subsequent MRs.
import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  route("/login", "app/routes/login.tsx"),
  route("/logout", "app/routes/logout.tsx"),
  route("/auth/callback", "app/routes/auth-callback.tsx"),
  route("/org/create", "app/routes/create-org.tsx"),
  layout("app/routes/app-shell.tsx", [
    index("app/routes/chat.tsx"),
    route("chat/:channelId", "app/routes/chat.tsx", { id: "chat-with-channel" }),
    route("projects", "app/routes/projects.tsx"),
    route("projects/:projectId", "app/routes/project-detail.tsx"),
    route(
      "projects/:projectId/datasets/:datasetId",
      "app/routes/project-detail.tsx",
      { id: "project-dataset-detail" },
    ),
    route("table/:datasetId", "app/routes/table.tsx"),
    route("view/:viewId", "app/routes/view-detail.tsx"),
    route("report/:reportId", "app/routes/report-detail.tsx"),
    route("query-engines", "app/routes/query-engines.tsx"),
    route("query-engines/:nodeId", "app/routes/query-engine-detail.tsx"),
    route("sessions", "app/routes/sessions.tsx"),
  ]),
] satisfies RouteConfig;
