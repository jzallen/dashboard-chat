/**
 * Catalog adapter — turns the app's data source (the mock `DC` catalog) into the
 * graph shapes the lineage views consume. The concrete data dependency lives
 * here so the graph library (src/lib/graph.ts) stays pure and source-agnostic;
 * swap this module when the catalog comes from the backend instead of a fixture.
 */
import type { AuditEntry, Edge, Graph, LineageNode } from "../lib/graph";
import { DC } from "./data.js";

/**
 * data.js is still plain JS; assert the shapes this adapter reads. Typing
 * data.js itself is a later extraction — until then this is the single boundary
 * where the catalog's structure is pinned down.
 */
const catalog = DC as unknown as {
  NODES: Record<string, LineageNode>;
  EDGES: Edge[];
  AUDIT: Record<string, AuditEntry[]>;
};

/**
 * Assemble the working graph from the static catalog plus runtime mutations:
 * merge any `extraNodes` (e.g. a mart added live by chat), drop `archived` nodes
 * and every edge touching them, and apply `nameOverrides` (id → new label).
 */
export function buildGraph(
  extraNodes?: LineageNode[],
  extraEdges?: Edge[],
  archived?: string[],
  nameOverrides?: Record<string, string>,
): Graph {
  const base: Record<string, LineageNode> = { ...catalog.NODES };
  (extraNodes || []).forEach((n) => {
    base[n.id] = n;
  });
  const archivedIds = new Set(archived || []);
  const nameOverrideMap = nameOverrides || {};
  const nodes: Record<string, LineageNode> = {};
  Object.values(base).forEach((n) => {
    if (archivedIds.has(n.id)) return;
    nodes[n.id] = nameOverrideMap[n.id]
      ? { ...n, label: nameOverrideMap[n.id] }
      : n;
  });
  const edges = [...catalog.EDGES, ...(extraEdges || [])].filter(
    ([a, b]) => !archivedIds.has(a) && !archivedIds.has(b),
  );
  return { nodes, edges };
}

/** Number of AI audit entries recorded against a node. */
export function auditCount(id: string): number {
  return (catalog.AUDIT[id] || []).length;
}
