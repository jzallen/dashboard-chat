// AuditView — lineage stream inlining the per-model audit (MR-2).
//
// RED scaffold authored by DISTILL. DELIVER implements the real render and
// removes the __SCAFFOLD__ marker.
//
// Renders the lineage as a vertical stream (one row per node, upstream→downstream
// order) inlining a per-model audit section. For MR-2 the audit section surfaces
// the derived dependency summary (which upstream models feed each node); the rich
// Assistant-changes provenance panel is MR-5. Orphan nodes are flagged in-stream.
export const __SCAFFOLD__ = true;

import type { LineageGraph } from "../../../core/lineage/buildGraph";

export interface AuditViewProps {
  graph: LineageGraph;
}

export function AuditView(_props: AuditViewProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (lineage MR-2)");
}
