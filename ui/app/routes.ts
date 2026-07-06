/**
 * The application route table.
 *
 * The app-shell layout is the persistent outer chrome (auth gate + Topbar +
 * overlays) — a single instance that never remounts on a project switch. Nested
 * inside it, the `project/:projectId` layout re-scopes the catalog to the path
 * project whenever `:projectId` changes (the re-scope seam).
 *
 * Project identity lives in the PATH
 * (`/project/:projectId/{dataset|view|report}/:id`), matching how the API scopes
 * resources by project. `org` and `query-engines` are org-global and sit outside
 * the project layout; `chats` nests under the project because sessions are
 * project-scoped. `onboarding` is top-level and outside the app-shell because the
 * principal has no org yet, so there is no shell to scope.
 *
 * The `/ui-server/*` routes are loader/action-only resource routes (no React) —
 * top-level so they carry none of the app-shell chrome or its clientLoader, and
 * run purely server-side as the SSR brokers to the backend through auth-proxy.
 * `health` is the auth-hop proof and `chat` relays the agent SSE; the catalog
 * mutations are RRv7 `action`s (ADR-034) the components submit to via
 * `<Form>` / `useFetcher`, brokering the write and letting the active loaders
 * auto-revalidate. The single `datasets/:datasetId` route is body-agnostic — both
 * a display-name rename and a model_name change hit the one backend
 * `/api/datasets/{id}` endpoint.
 *
 * File paths resolve relative to `appDirectory` ("app"), so the leading `app/`
 * segment is omitted.
 */
import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  route("/login", "routes/login.tsx"),
  route("/logout", "routes/logout.tsx"),
  route("/auth/callback", "routes/auth-callback.tsx"),
  route("/onboarding", "routes/onboarding.tsx"),
  route("/ui-server/health", "routes/ui-server/health.tsx"),
  route("/ui-server/chat", "routes/ui-server/chat.tsx"),
  route("/ui-server/orgs/me", "routes/ui-server/orgs-me.tsx"),
  route("/ui-server/orgs", "routes/ui-server/orgs.tsx"),
  route("/ui-server/projects", "routes/ui-server/projects.tsx"),
  route("/ui-server/datasets/:datasetId/archive", "routes/ui-server/dataset-archive.tsx"),
  route("/ui-server/datasets/:datasetId/restore", "routes/ui-server/dataset-restore.tsx"),
  route("/ui-server/datasets/:datasetId", "routes/ui-server/dataset-update.tsx"),
  route("/ui-server/projects/:projectId/views/:viewId", "routes/ui-server/view-rename.tsx"),
  route("/ui-server/projects/:projectId/reports/:reportId", "routes/ui-server/report-rename.tsx"),
  route("/ui-server/projects/:projectId/audit/:auditEntryId", "routes/ui-server/audit-update.tsx"),
  route("/ui-server/uploads", "routes/ui-server/uploads.tsx"),
  route("/ui-server/sources", "routes/ui-server/source-create.tsx"),
  route("/ui-server/sources/:sourceId/uploads", "routes/ui-server/upload-request.tsx"),
  route("/ui-server/sources/:sourceId/uploads/:uploadId/process", "routes/ui-server/upload-process.tsx"),
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
