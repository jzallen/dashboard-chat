// Breadcrumb navigation shell — RED scaffold (created by DISTILL, MR-3).
//
// Transparent floating breadcrumb that replaces the SideNav (path-forward §4.1).
// Route-context-aware:
//   • list / pipeline views:  OrgIcon / Project ▾            (project picker)
//   • model views:            OrgIcon / Project (link) / Model ▾  (model picker)
// The org icon is a toggle that opens the Org Settings sheet via the `?org=1`
// search param and morphs to an × while open; project-scoped affordances are
// hidden while the org sheet is open. A minimal utility menu keeps New Session,
// All Chats (/sessions), and Query Engines (/query-engines) reachable until the
// assistant overlay (MR-4) absorbs the session controls.
//
// Picker data comes from the existing dataCatalog TanStack Query hooks — the
// ui-state wire is NOT touched (saved-feedback constraint).
export const __SCAFFOLD__ = true;

export function Breadcrumb(): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (breadcrumb MR-3)");
}

export default Breadcrumb;
