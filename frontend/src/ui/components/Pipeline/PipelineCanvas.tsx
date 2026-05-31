// PipelineCanvas — presentational pipeline surface with in-canvas style switch (MR-2).
//
// RED scaffold authored by DISTILL. DELIVER implements the real render and
// removes the __SCAFFOLD__ marker.
//
// Holds the active style (Flow / Lanes / Audit) in local state and renders the
// matching view over the SAME graph. Pure presentational — the graph is built
// upstream by the data-connected landing (./index) so the canvas stays testable
// in isolation. Default style is Flow.
export const __SCAFFOLD__ = true;

import type { LineageGraph } from "../../../core/lineage/buildGraph";

export type PipelineStyle = "flow" | "lanes" | "audit";

export interface PipelineCanvasProps {
  graph: LineageGraph;
  /** Optional initial style override (defaults to "flow"). */
  initialStyle?: PipelineStyle;
}

export function PipelineCanvas(_props: PipelineCanvasProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (lineage MR-2)");
}
