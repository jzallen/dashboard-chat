/**
 * Per-node view-models for the lineage views — pure selectors over the
 * {@link DataCatalog} port. The container views call these once per node and
 * hand the leaf cards PLAIN DATA, so the presentational cards (Node, LaneCard,
 * ModelTrailCard) never reach into the catalog themselves. State/presentation
 * segregation: the catalog is read here, at the container edge, not in a leaf.
 */
import type { AuditEntry, DataCatalog } from "../../catalog";

/**
 * The DAG's hover/selection focus derivation — which edges are "hot" (incident
 * to the focused node) and a membership test for dimming off-focus nodes. Pure
 * over the {@link DataCatalog}; the container feeds `focusNodeId` (hover ?? sel)
 * and renders from the result. `null` focus means nothing is dimmed or hot.
 */
export interface DagFocusModel {
  /** Indices (into `catalog.listEdges()`) of edges incident to the focus node. */
  hotEdges: Set<number>;
  /** True when `nodeId` should be dimmed: focus is set and it is not adjacent. */
  isDimmed: (nodeId: string) => boolean;
}

export function dagFocusModel(
  catalog: DataCatalog,
  focusNodeId: string | null,
): DagFocusModel {
  const hotEdges = new Set<number>();
  if (focusNodeId) {
    catalog.listEdges().forEach((edge, index) => {
      if (catalog.isEdgeAdjacent(edge, focusNodeId)) hotEdges.add(index);
    });
  }
  return {
    hotEdges,
    isDimmed: (nodeId: string) =>
      !!focusNodeId &&
      focusNodeId !== nodeId &&
      !catalog.isNodeAdjacent(focusNodeId, nodeId),
  };
}

/** Data the swimlane `LaneCard` renders: upstream labels + AI-edit count. */
export interface LaneCardData {
  parentLabels: string[];
  auditCount: number;
}

export function laneCardViewModel(
  catalog: DataCatalog,
  nodeId: string,
): LaneCardData {
  return {
    parentLabels: catalog.parentsOf(nodeId).map((p) => p.label),
    auditCount: catalog.auditCount(nodeId),
  };
}

/** Data the audit-log `ModelTrailCard` renders: the folded audit trail. */
export interface AuditTrailData {
  audit: AuditEntry[];
}

export function auditTrailViewModel(
  catalog: DataCatalog,
  nodeId: string,
): AuditTrailData {
  return { audit: catalog.auditFor(nodeId) };
}

/** The AI-edit count the DAG `Node` renders. */
export function dagNodeAuditCount(
  catalog: DataCatalog,
  nodeId: string,
): number {
  return catalog.auditCount(nodeId);
}
