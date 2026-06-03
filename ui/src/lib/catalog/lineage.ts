/**
 * Lineage domain types + layer vocabulary — the catalog's entity language. A
 * dependency-free set of plain shapes describing the pipeline's data: the
 * {@link Layer} ordering, field/audit/model descriptors, and the {@link Graph}
 * of {@link LineageNode}s and {@link Edge}s.
 *
 * This is the catalog's lowest layer and owns the types the rest of the catalog
 * (source.ts, models.ts, client.ts) is built on. Dependencies point inward:
 * the app-side lineage view (src/app/lineageLayout.ts) imports these types from
 * the catalog, never the reverse.
 */

/** The pipeline layers, ordered left-to-right / upstream-to-downstream. */
export const LAYER_ORDER = ["source", "staging", "intermediate", "mart"] as const;

/**
 * A single data-pipeline layer. Derived from {@link LAYER_ORDER} so the list is
 * the single source of truth — add a layer there and this type follows.
 */
export type Layer = (typeof LAYER_ORDER)[number];

/** A field/column descriptor as it appears in source schemas and model refs. */
export interface FieldDef {
  name: string;
  type: string;
}

/** One assistant audit entry: which tool ran and the human-readable summary. */
export interface AuditEntry {
  tool: string;
  say: string;
  tag: string;
}

/**
 * A model reference attached to staging/intermediate/mart nodes. Heterogeneous
 * by kind — datasets carry `fields`, views `columns`, reports `columns_metadata`
 * — so the field-list keys are all optional.
 */
export interface ModelRef {
  fields?: FieldDef[];
  columns?: unknown[];
  columns_metadata?: unknown[];
  [key: string]: unknown;
}

/** A node in the lineage graph: a raw source upload or a dbt model. */
export interface LineageNode {
  id: string;
  label: string;
  sub: string;
  layer: Layer;
  ref?: ModelRef; // absent for source nodes
  schema?: FieldDef[]; // source-only
  files?: { name: string; rows: number; when: string }[];
  audit?: AuditEntry[];
}

/** A directed edge `[from, to]` between two node ids. */
export type Edge = [string, string];

/** The assembled lineage graph: nodes keyed by id, plus directed edges. */
export interface Graph {
  nodes: Record<string, LineageNode>;
  edges: Edge[];
}
