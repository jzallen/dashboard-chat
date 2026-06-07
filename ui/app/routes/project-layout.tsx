/* /project/:projectId — the thin project layout nested inside app-shell. Its
   clientLoader re-scopes the session catalog to the path project, and RRv7
   re-fires the loader on every :projectId change — that's the re-scope seam.
   The single catalog instance is preserved: the persistent chrome
   (Topbar) keeps its useSyncExternalStore subscriptions; only the snapshot's
   project-scoped payloads (currentProject + lineage graph) change. The body is
   just <Outlet/> — the nested resource routes render under the re-scoped graph. */
import { Outlet, useOutletContext } from "react-router";

import { selectProject } from "../components/useCatalog";

export function clientLoader({ params }: { params: { projectId?: string } }) {
  // Re-scope synchronously so the route renders without a navigation-pending
  // gap (a sync loader lets RRv7 commit the route immediately; the resource view
  // shows its skeleton until the lineage commit lands). RRv7 re-fires the loader
  // on every :projectId change — that's the re-scope seam. selectProject sets
  // the scoped-pid holder the backend source reads, then KICKS (does not await)
  // the project-scoped getters; the lineage commit lands a beat later.
  selectProject(params.projectId!);
  return null;
}

// Re-scope only when the path project changes. Without this, RRv7 revalidates
// this loader on every navigation under the layout — including search-param-only
// changes (e.g. the workspace's `?view=` toggle) and nested resource navigations
// — needlessly re-kicking selectProject (a catalog re-fetch). selectProject's
// only input is projectId, so projectId-equality is the precise revalidation key.
export function shouldRevalidate({
  currentParams,
  nextParams,
}: {
  currentParams: { projectId?: string };
  nextParams: { projectId?: string };
}) {
  return currentParams.projectId !== nextParams.projectId;
}

export default function ProjectLayout() {
  // Forward app-shell's outlet context (onOpenNode) down to the nested resource
  // routes — without this, their useShellContext() would read THIS Outlet's
  // (empty) context instead of the chrome's.
  const ctx = useOutletContext();
  return <Outlet context={ctx} />;
}
