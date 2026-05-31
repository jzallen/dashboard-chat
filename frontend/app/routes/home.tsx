// Framework-mode index route — `/` (MR-4).
//
// RED scaffold (created by DISTILL). MR-4 swaps the `/` index from chat to the
// Pipeline landing (path-forward §4.2): chat is no longer a top-level page — it is
// the everywhere assistant overlay. The Pipeline route is project-scoped
// (`projects/:projectId/pipeline`), so the index resolves the org's default project
// (the same first-project fallback the shell already uses) and redirects there.
//
// Resolution is CLIENT-side off the AppShell outlet context (`projects`) rather than
// a server loader: the Pipeline graph is built from the dataCatalog REST hooks, and
// server-side dataCatalog fetching is deferred (MR-2 DWD-M2-2) — so a server index
// loader would have nothing to read. Zero projects → `/projects` (never strand the
// user); projects still loading → a resolving placeholder. The standalone
// `/chat/:channelId` + `/sessions` deep-links remain registered (DWD-M4-5).
export const __SCAFFOLD__ = true;

export function HomeRedirect(): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (home index MR-4)");
}

export default HomeRedirect;
