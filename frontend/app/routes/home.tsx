// Framework-mode index route — `/` (MR-4).
//
// MR-4 swaps the `/` index from chat to the Pipeline landing (path-forward §4.2):
// chat is no longer a top-level page — it is the everywhere assistant overlay. The
// Pipeline route is project-scoped (`projects/:projectId/pipeline`), so the index
// resolves the org's default (first) project off the AppShell outlet context — the
// same first-project fallback the shell already uses — and redirects there.
//
// Resolution is CLIENT-side (off the outlet context) rather than a server loader:
// the Pipeline graph is built from the dataCatalog REST hooks and server-side
// dataCatalog fetching is deferred (MR-2 DWD-M2-2), so a server index loader would
// have nothing to read. Zero projects → `/projects` (never strand the user; the
// projects route shows the list/empty state). Projects still loading → a resolving
// placeholder. The standalone `/chat/:channelId` + `/sessions` deep-links remain
// registered (DWD-M4-5).
import { Navigate, useOutletContext } from "react-router";

import type { AppShellContext } from "../../src/ui/components/AppShell";

export function HomeRedirect(): JSX.Element {
  const { projects } = useOutletContext<AppShellContext>();

  // Projects still in flight — hold on a placeholder rather than redirect blindly.
  if (projects === null) {
    return <div data-testid="home-resolving" />;
  }

  // No projects — never strand: the projects route owns the list / empty state.
  if (projects.length === 0) {
    return <Navigate to="/projects" replace />;
  }

  // Default landing: the first project's Pipeline lineage view (path-forward §4.2).
  return <Navigate to={`/projects/${projects[0].id}/pipeline`} replace />;
}

export default HomeRedirect;
