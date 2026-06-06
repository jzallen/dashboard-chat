// RRv7 framework-mode route table (Phase 3 — foamy-knitting-hennessy:
// project-in-path). app-shell stays the persistent outer chrome (RequireAuth +
// Topbar + overlays — one instance, never remounts on a project switch); a thin
// `project/:projectId` layout nests inside it, whose clientLoader re-scopes the
// catalog to the path project on every :projectId change (the re-scope seam).
//
// URL shape: project is part of a resource's identity at the API
// (/api/datasets?project_id=, /api/projects/:id/views|reports), so it lives in
// the PATH: /project/:projectId/{dataset|view|report}/:id (uniform nested
// singular). The resource entry is `dataset` (the entity IS a dataset; the old
// `table` segment was a misnomer). org + query-engines stay org-global (outside
// the project layout, inside app-shell). /chats nests under the project now
// (sessions are project-scoped; the backend wiring is a later slice).
//
// Merge-reconciliation point: frontend/ uses plural/top-level
// (projects/:projectId/datasets/:datasetId); this prototype uses
// singular-nested. Reconciled when ui/ merges into frontend/.
//
// Path resolution note (mirrors frontend/app/routes.ts): file paths are resolved
// relative to appDirectory ("app"), so the leading `app/` segment is omitted.
import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  route("/login", "routes/login.tsx"),
  route("/auth/callback", "routes/auth-callback.tsx"),
  layout("routes/app-shell.tsx", [
    index("routes/home-redirect.tsx"),
    route("org", "routes/org.tsx"),
    route("query-engines", "routes/query-engines.tsx"),
    route("project/:projectId", "routes/project-layout.tsx", [
      index("routes/workspace.tsx"),
      route("dataset/:datasetId", "routes/dataset-detail.tsx"),
      route("view/:viewId", "routes/view-detail.tsx"),
      route("report/:reportId", "routes/report-detail.tsx"),
      route("chats", "routes/chats.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
