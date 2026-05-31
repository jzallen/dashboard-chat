// PipelineLanding — data-connected lineage landing for a selected project (MR-2).
//
// RED scaffold authored by DISTILL. DELIVER implements the real render and
// removes the __SCAFFOLD__ marker.
//
// The landing surface for a selected project (path-forward.md §4.2 — registered
// at `projects/:projectId/pipeline`; the full `/`-index swap + chat-as-overlay is
// MR-4). Reads the active project from the route params, pulls datasets / views /
// reports from the existing dataCatalog TanStack Query hooks (NOT ui-state), builds
// the lineage graph (empty archived set — cold storage is MR-7), and renders
// PipelineCanvas. Handles loading + empty-project states.
export const __SCAFFOLD__ = true;

export function PipelineLanding(): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (lineage MR-2)");
}

export default PipelineLanding;
