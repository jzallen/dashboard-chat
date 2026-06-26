// Route table. The app-shell layout is the persistent outer chrome (auth gate +
// Topbar + overlays) — a single instance that never remounts on a project switch.
// Nested inside it, the `project/:projectId` layout re-scopes the catalog to the
// path project whenever :projectId changes (the re-scope seam).
//
// Project identity lives in the PATH (/project/:projectId/{dataset|view|report}/:id),
// matching how the API scopes resources by project. org + query-engines are
// org-global and sit outside the project layout; chats nest under the project
// because sessions are project-scoped.
//
// File paths resolve relative to appDirectory ("app"), so the leading `app/`
// segment is omitted.
import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  route("/login", "routes/login.tsx"),
  route("/logout", "routes/logout.tsx"),
  route("/auth/callback", "routes/auth-callback.tsx"),
  // Top-level, OUTSIDE the app-shell layout (D6): onboarding renders with no
  // Topbar/overlays — the principal has no org yet, so no shell to scope.
  route("/onboarding", "routes/onboarding.tsx"),
  // ui-server resource routes (loader/action only, no React). Top-level so they carry
  // none of the app-shell chrome or its clientLoader; they run purely server-side
  // and broker the live agent rails (SSR ui-server gateway, slice 1). /ui-server/health is
  // the auth-hop proof; /ui-server/chat relays the agent SSE.
  route("/ui-server/health", "routes/ui-server/health.tsx"),
  route("/ui-server/chat", "routes/ui-server/chat.tsx"),
  // Catalog mutations are RRv7 `action`s homed on same-origin /ui-server resource
  // routes (ADR-034): the component submits via <Form>/useFetcher, the action
  // brokers the write through auth-proxy, and the active loaders auto-revalidate.
  route("/ui-server/datasets/:datasetId/archive", "routes/ui-server/dataset-archive.tsx"),
  route("/ui-server/datasets/:datasetId/restore", "routes/ui-server/dataset-restore.tsx"),
  // dataset PATCH is body-agnostic: display-name rename AND model_name change
  // both hit the one backend /api/datasets/{id} endpoint.
  route("/ui-server/datasets/:datasetId", "routes/ui-server/dataset-update.tsx"),
  route("/ui-server/projects/:projectId/views/:viewId", "routes/ui-server/view-rename.tsx"),
  route("/ui-server/projects/:projectId/reports/:reportId", "routes/ui-server/report-rename.tsx"),
  route("/ui-server/projects/:projectId/audit/:auditEntryId", "routes/ui-server/audit-update.tsx"),
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
