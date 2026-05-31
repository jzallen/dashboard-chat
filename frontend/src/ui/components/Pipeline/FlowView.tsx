// FlowView — left→right lineage DAG (MR-2).
//
// RED scaffold authored by DISTILL. DELIVER implements the real render and
// removes the __SCAFFOLD__ marker.
//
// Renders the graph as a layered left→right flow: nodes grouped into layer
// columns (source → staging → intermediate → mart), edges drawn between them.
// Orphan nodes render DISABLED (aria-disabled). Consumes MR-1 layer-accent tokens.
export const __SCAFFOLD__ = true;

import type { LineageGraph } from "../../../core/lineage/buildGraph";

export interface FlowViewProps {
  graph: LineageGraph;
}

export function FlowView(_props: FlowViewProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (lineage MR-2)");
}
