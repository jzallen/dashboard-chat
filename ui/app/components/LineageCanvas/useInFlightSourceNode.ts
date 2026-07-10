/**
 * useInFlightSourceNode — the single seam between the canvas's two view
 * substrates. The lineage graph lives in the catalog snapshot; the in-flight
 * source-upload phase lives in the XState ui-state region. Reading
 * both inline in the DAG view interleaves divergent cadences and reads "stale".
 *
 * This hook stitches them once and hands the canvas one derived value —
 * `{ inFlightNodeId, inFlightLabel }` — so the view renders a single optimistic
 * node badge instead of reconstructing id/phase logic beside its layout reads.
 */
import {
  isInFlightPhase,
  sourceUploadPhaseLabel,
  useSourceUpload,
} from "./sourceUploadPhase";

export interface InFlightSourceNode {
  /**
   * The node the saga is advancing: the real `source_id` once created, else the
   * optimistic `temp_node_id`. `null` off the saga (idle / linked).
   */
  inFlightNodeId: string | null;
  /** The phase badge for that node, or `null` off the saga. */
  inFlightLabel: string | null;
}

export function useInFlightSourceNode(): InFlightSourceNode {
  const sourceUpload = useSourceUpload();
  const inFlight = isInFlightPhase(sourceUpload.phase);
  return {
    inFlightNodeId: inFlight
      ? (sourceUpload.source_id ?? sourceUpload.temp_node_id)
      : null,
    inFlightLabel: inFlight ? sourceUploadPhaseLabel(sourceUpload.phase) : null,
  };
}
