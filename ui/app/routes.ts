// RRv7 framework-mode route table (Phase 1 — foamy-knitting-hennessy). Mirrors
// frontend/app/routes.ts so a later merge of ui/ into frontend/ is mechanical:
// a layout route (app-shell) wrapping the index + split resource routes, plus
// top-level /login + /auth/callback.
//
// Deliberate divergences (reconciled at merge): projectId rides as ?project=
// query rather than a path segment; /chats keeps its user-facing name (frontend
// uses /sessions); ssr:false (no server runtime in the prototype).
//
// Path resolution note (mirrors frontend/app/routes.ts): file paths are resolved
// relative to appDirectory ("app"), so the leading `app/` segment is omitted.
import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  route("/login", "routes/login.tsx"),
  route("/auth/callback", "routes/auth-callback.tsx"),
  layout("routes/app-shell.tsx", [
    index("routes/workspace.tsx"),
    route("table/:datasetId", "routes/table.tsx"),
    route("view/:viewId", "routes/view-detail.tsx"),
    route("report/:reportId", "routes/report-detail.tsx"),
    route("query-engines", "routes/query-engines.tsx"),
    route("chats", "routes/chats.tsx"),
    route("org", "routes/org.tsx"),
  ]),
] satisfies RouteConfig;
