// LanesView — layer swimlanes (MR-2).
//
// RED scaffold authored by DISTILL. DELIVER implements the real render and
// removes the __SCAFFOLD__ marker.
//
// Renders one horizontal swimlane per layer (staging / intermediate / mart in
// MR-2; source reserved for MR-6), placing each node in its layer's lane. Orphan
// nodes carry an "Orphaned" badge. Consumes MR-1 layer-accent tokens.
export const __SCAFFOLD__ = true;

import type { LineageGraph } from "../../../core/lineage/buildGraph";

export interface LanesViewProps {
  graph: LineageGraph;
}

export function LanesView(_props: LanesViewProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (lineage MR-2)");
}
