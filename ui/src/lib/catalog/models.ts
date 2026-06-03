/**
 * Catalog model types — fixture-faithful shapes for the data the app reads from
 * its catalog (src/app/data.js today, a backend later). These are the domain
 * vocabulary the {@link createDataCatalog} factory returns and components
 * consume.
 *
 * Leaf types (column/join/filter/grain descriptors, semantic roles) are adapted
 * from the real frontend dataCatalog types (frontend/src/core/dataCatalog/*),
 * trimmed to the fields the fixture actually carries. Graph-shaped types
 * (nodes, edges, audit) are reused from ./lineage — the inward-pointing
 * dependency; lineage.ts itself imports nothing.
 */
import type { Edge, FieldDef, Layer, LineageNode } from "./lineage";

/* ─── leaf descriptors (adapted from frontend/src/core/dataCatalog) ─────────── */

/** How a column renders / what kind of value it holds. */
export type DisplayType =
  | "text"
  | "category"
  | "id"
  | "serial"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "time"
  | "datetime";

/** A view column's role in the grain (time / dimension / entity / metric). */
export type GrainRole = "Time" | "Dimension" | "Entity" | "Metric";

/** A report column's semantic role in the mart. */
export type SemanticRole = "entity" | "dimension" | "measure";

/** Materialization strategy a view/report compiles to. */
export type Materialization = "ephemeral" | "view" | "table" | "incremental";

/** A reference from a model to one of its upstream sources. */
export interface SourceRef {
  id: string;
  type: "dataset" | "view";
}

/** One projected column on a view, traced back to its source column. */
export interface ViewColumn {
  name: string;
  source_ref: string;
  source_column: string;
  display_type: DisplayType;
  grain_role: GrainRole;
}

/** A join between two of a view's sources. */
export interface ViewJoin {
  left_ref: string;
  left_column: string;
  right_ref: string;
  right_column: string;
  join_type: string;
}

/** A row-filter applied to one of a view's sources. */
export interface ViewFilter {
  source_ref: string;
  column: string;
  operator: string;
  value: string;
}

/** A view's declared grain: its time column and grouping dimensions. */
export interface ViewGrain {
  time_column: string;
  dimensions: string[];
}

/** A report column plus its semantic metadata (role, type, expression). */
export interface ColumnMetadata {
  name: string;
  semantic_role: SemanticRole;
  semantic_type: string;
  expr?: string;
  time_granularity?: string;
  description?: string;
}

/* ─── shared model pieces ───────────────────────────────────────────────────── */

/** A cleaning/shaping transform recorded against a dataset column. */
export interface Transform {
  id: string;
  name: string;
  op: string;
  column: string;
  status: string;
  detail: string;
  sample: { before: string; after: string };
}

/** A single preview row — a map of column name to cell value. */
export type PreviewRow = Record<string, string | number | null>;

/* ─── the three model kinds + their union ───────────────────────────────────── */

/** A staging dataset: a cleaned, one-to-one projection of an uploaded CSV. */
export interface DatasetModel {
  kind: "dataset";
  layer: Layer;
  node: string;
  id: string;
  name: string;
  model: string;
  rows: number;
  fields: FieldDef[];
  preview: PreviewRow[];
  transforms: Transform[];
  sql: string;
}

/** An intermediate view: a join/reshape across staging datasets. */
export interface ViewModel {
  kind: "view";
  layer: Layer;
  node: string;
  id: string;
  name: string;
  model: string;
  materialization: Materialization;
  rows: number;
  source_refs: SourceRef[];
  columns: ViewColumn[];
  joins: ViewJoin[];
  filters: ViewFilter[];
  grain: ViewGrain;
  preview: PreviewRow[];
  sql: string;
}

/** A mart report: an aggregation ready for consumption (fact or dimension). */
export interface ReportModel {
  kind: "report";
  layer: Layer;
  node: string;
  id: string;
  name: string;
  model: string;
  report_type: "fact" | "dimension";
  materialization: Materialization;
  domain: string;
  rows: number;
  source_refs: SourceRef[];
  preview: PreviewRow[];
  columns_metadata: ColumnMetadata[];
  sql: string;
}

/** Any catalog model, discriminated by `kind`. */
export type Model = DatasetModel | ViewModel | ReportModel;

/* ─── top-level catalog payloads ────────────────────────────────────────────── */

/** A project as it appears in the project list. */
export interface ProjectSummary {
  id: string;
  name: string;
  desc: string;
  datasets: number;
  models: number;
}

/** The currently-open project's identity. */
export interface CurrentProject {
  id: string;
  name: string;
  description: string;
}

/** A member of the org. */
export interface OrgMember {
  name: string;
  email: string;
  role: string;
}

/** Org-wide settings: plan, seats, members, and modelling defaults. */
export interface OrgSettings {
  name: string;
  slug: string;
  region: string;
  plan: string;
  seats: number;
  usedSeats: number;
  created: string;
  members: OrgMember[];
  defaults: { engine: string; materialization: string; modelPrefix: string };
}

/** A past chat, shown in the recents list and the full history. */
export interface ChatHistoryItem {
  title: string;
  nodeId: string | null;
  when?: string;
  snippet?: string;
}

/** One streamed turn of the scripted chat: assistant prose or a tool action. */
export type ChatTurn =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; say: string; tag: string };

/** The scripted "build a new mart" chat: the prompt, what it creates, the turns. */
export interface ChatScript {
  prompt: string;
  newNode: LineageNode;
  newEdge: Edge;
  turns: ChatTurn[];
}

/** A file in the exported dbt project tree. */
export interface DbtFile {
  path: string;
  layer: Layer | "config";
  ref?: string;
}
