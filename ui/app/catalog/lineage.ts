/**
 * Lineage domain types + layer vocabulary — the catalog's entity language. A
 * dependency-free set of plain shapes describing the pipeline's data: the
 * {@link Layer} ordering, field/audit/model descriptors, and the {@link Graph}
 * of {@link LineageNode}s and {@link Edge}s.
 *
 * This is the catalog's lowest layer and owns the types the rest of the catalog
 * (source.ts, models.ts, client.ts) is built on. Dependencies point inward:
 * the app-side lineage view (app/components/LineageCanvas/lineageLayout.ts) imports these types from
 * the catalog, never the reverse.
 */

/**
 * The source layer — raw uploaded CSVs. Unlike the model-bearing layers it has
 * no backend entity and carries no assistant transforms, so audit-facing code
 * derives "layers with an audit trail" by excluding it (rather than slicing a
 * position off {@link LAYER_ORDER}).
 */
export const SOURCE_LAYER = "source" as const;

/** The pipeline layers, ordered left-to-right / upstream-to-downstream. */
export const LAYER_ORDER = [
  SOURCE_LAYER,
  "staging",
  "intermediate",
  "mart",
] as const;

/**
 * A single data-pipeline layer. Derived from {@link LAYER_ORDER} so the list is
 * the single source of truth — add a layer there and this type follows.
 */
export type Layer = (typeof LAYER_ORDER)[number];

/**
 * The kind of a model-bearing node — the catalog entity behind a non-source
 * node. Maps 1:1 to the pipeline layer: staging→dataset, intermediate→view,
 * mart→report. Source-layer nodes have no model kind (no backend entity).
 */
export type ModelKind = "dataset" | "view" | "report";

/**
 * The model kind behind a node, derived from its pipeline layer (the domain
 * 1:1: staging→dataset, intermediate→view, mart→report). `undefined` for
 * source-layer nodes, which have no backend model entity.
 */
export function modelKindForLayer(layer: Layer): ModelKind | undefined {
  switch (layer) {
    case "staging":
      return "dataset";
    case "intermediate":
      return "view";
    case "mart":
      return "report";
    default:
      return undefined;
  }
}

/** A field/column descriptor as it appears in source schemas and model refs. */
export interface FieldDef {
  name: string;
  type: string;
}

/**
 * Transform categories the assistant tags its edits with — the vocabulary
 * shared by audit trails ({@link AuditEntry}) and scripted chat tool-turns.
 * The single source of truth: the presentation layer's tag→icon map is keyed
 * by this type, so every tag is guaranteed a glyph (no runtime fallback).
 */
export const AUDIT_TAGS = [
  "create",
  "source",
  "join",
  "filter",
  "grain",
  "measure",
  "config",
  "clean",
  "fix",
  "cast",
  "shape",
] as const;

/** A single assistant transform category. Derived from {@link AUDIT_TAGS}. */
export type AuditTag = (typeof AUDIT_TAGS)[number];

/** One assistant audit entry: which tool ran and the human-readable summary. */
export interface AuditEntry {
  tool: string;
  say: string;
  tag: AuditTag;
  /** The backing AssistantAuditEntry id (the write target for the toggle). */
  auditEntryId?: string;
  /**
   * The joined transform id — present (non-null) iff the entry is transform-type
   * (a Transform points UP at the entry), i.e. the entry is toggleable. `null`
   * for log-only entries; absent for fixture entries.
   */
  transformId?: string | null;
  /** The joined transform's enabled state; absent/`null` for log-only calls. */
  enabled?: boolean;
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
  /**
   * The dataset's dbt machine name (`stg_<snake>`), derived once at creation
   * from the display name and decoupled thereafter. Staging-node only; absent
   * for legacy rows (created before the column existed) and non-dataset nodes.
   * Rendered READ-ONLY as the ModelDetail subheader.
   */
  modelName?: string;
  ref?: ModelRef; // absent for source nodes
  schema?: FieldDef[]; // source-only
  files?: { name: string; rows: number; when: string }[];
  audit?: AuditEntry[];
}

/** A directed edge `[from, to]` between two node ids. */
export type Edge = [string, string];

/**
 * An archived source held in cold storage: enough of the retired node to list
 * and restore it, plus the retirement timestamp and retention window.
 */
export interface ColdStorageItem {
  id: string;
  name: string;
  /**
   * The retired node's pipeline layer. Drives restore routing: a `source` was
   * archived client-side (no backend entity) and restores locally; any other
   * layer is a server-archived dataset and restores through the backend.
   */
  layer: Layer;
  schema?: FieldDef[];
  files?: { name: string; rows: number; when: string }[];
  retiredAt: number;
  retentionDays: number;
}

/** The assembled lineage graph: nodes keyed by id, plus directed edges. */
export interface Graph {
  nodes: Record<string, LineageNode>;
  edges: Edge[];
}
