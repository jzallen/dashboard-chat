/**
 * lineageMappers — pure, fetch-free mappers that derive the catalog's lineage
 * graph from the backend's three entity lists (datasets, views, reports). The
 * backend has NO lineage endpoint, so the graph is assembled client-side:
 *
 *   - Dataset → `staging` node (graph ROOT; datasets are views over raw S3
 *     uploads, so they carry no upstream `source_refs`).
 *   - View    → `intermediate` node.
 *   - Report  → `mart` node.
 *
 * Node ids are the backend UUIDs verbatim, so a view/report `source_ref.id`
 * lines up with the referenced node's id and an edge `[source_ref.id, entity.id]`
 * resolves with zero remapping.
 *
 * Each node's `ref` is ADAPTED to the {@link import("../models").Model} shape
 * `ModelDetail` reads (`kind`, `sql`, `rows`, `preview`, per-kind fields) — the
 * backend's `sql_definition`/`staging_sql` map to `sql`, and `rows`/`preview`/
 * `transforms` are defaulted. The `ref` is assigned to the index-signature
 * {@link ModelRef} bag, so the adapted objects typecheck.
 *
 * Dependency direction: imports only the lineage types — no fetch, no app-auth,
 * no React. The fetch lives in {@link metadataApiSource}; this module is pure.
 */
import type { Edge, FieldDef, LineageNode } from "../lineage";

/** A `{id,type}` upstream reference a view/report carries. */
export interface BackendSourceRef {
  id: string;
  type: "dataset" | "view";
}

/**
 * A dataset as the list endpoint serializes it (post envelope-unwrap). Maps to a
 * `staging` node. `schema_config` is NESTED (`{ fields: { col: { type, label? } } }`)
 * and may be `{}`; in the list path `preview_rows` is `[]` and `transforms` may be
 * unpopulated — the mapper defaults both.
 */
export interface BackendDataset {
  id: string;
  name: string;
  display_name?: string | null;
  description?: string | null;
  schema_config?: { fields?: Record<string, { type?: unknown; label?: unknown }> };
  transforms?: unknown[];
  preview_rows?: unknown[];
  row_count?: number;
  staging_sql?: string;
  archived_at?: string | null;
  /**
   * The Source this dataset is the `SELECT *` staging view over, when it was
   * created from a Source upload. Absent on LEGACY datasets (created the old
   * 1:1 upload→dataset way) — those stay graph ROOTS, exactly as before.
   */
  source_id?: string | null;
}

/**
 * A source as the list endpoint serializes it (post envelope-unwrap). A Source is
 * a logical table backed by one or more uploaded files sharing a schema; it maps
 * to a `source`-layer node (the upstream-most layer). `schema_config` is NESTED
 * like a dataset's (`{ fields: { col: { type, label? } } }`) and may be absent
 * before the first upload locks the schema.
 */
export interface BackendSource {
  id: string;
  name: string;
  schema_config?: { fields?: Record<string, { type?: unknown; label?: unknown }> };
}

/** A view as the list endpoint serializes it. Maps to an `intermediate` node. */
export interface BackendView {
  id: string;
  name: string;
  description?: string | null;
  sql_definition?: string;
  source_refs?: BackendSourceRef[];
  columns?: unknown[];
  joins?: unknown[];
  filters?: unknown[];
  grain?: unknown;
  materialization?: string;
}

/** A report as the list endpoint serializes it. Maps to a `mart` node. */
export interface BackendReport {
  id: string;
  name: string;
  description?: string | null;
  sql_definition?: string;
  report_type?: string;
  source_refs?: BackendSourceRef[];
  domain?: string;
  columns_metadata?: unknown[];
  materialization?: string;
}

/**
 * Flatten a dataset's NESTED `schema_config.fields` into the catalog's flat
 * {@link FieldDef} list. Defaults to `[]` when `schema_config`/`fields` is absent
 * and `"text"` for a missing field type.
 */
export function toFields(
  schema_config?: BackendDataset["schema_config"],
): FieldDef[] {
  return Object.entries(schema_config?.fields ?? {}).map(([name, cfg]) => ({
    name,
    type: String((cfg as { type?: unknown })?.type ?? "text"),
  }));
}

/**
 * Adapt a source to a `source`-layer {@link LineageNode}. Source nodes carry NO
 * `ref` (no backend model entity behind them — they are raw uploads, not dbt
 * models); the column schema lives on the top-level `schema` and `files` lists
 * the uploads. `files` is `[]` for now — surfacing the per-source upload list is
 * a later enhancement (slice 5+).
 */
export function toSourceNode(s: BackendSource): LineageNode {
  return {
    id: s.id,
    label: s.name,
    sub: "source",
    layer: "source",
    schema: toFields(s.schema_config),
    files: [],
  };
}

/** Adapt a dataset to a `staging` {@link LineageNode} (a graph root). */
export function toStagingNode(d: BackendDataset): LineageNode {
  const label = d.display_name ?? d.name;
  return {
    id: d.id,
    label,
    sub: "staging",
    layer: "staging",
    ref: {
      kind: "dataset",
      id: d.id,
      name: label,
      model: d.name,
      fields: toFields(d.schema_config),
      transforms: d.transforms ?? [],
      preview: d.preview_rows ?? [],
      rows: d.row_count ?? 0,
      sql: d.staging_sql ?? "",
      materialization: "view",
    },
  };
}

/** Adapt a view to an `intermediate` {@link LineageNode}. */
export function toViewNode(v: BackendView): LineageNode {
  return {
    id: v.id,
    label: v.name,
    sub: "intermediate",
    layer: "intermediate",
    ref: {
      kind: "view",
      id: v.id,
      name: v.name,
      model: v.name,
      materialization: v.materialization,
      rows: 0,
      source_refs: v.source_refs,
      columns: v.columns,
      joins: v.joins,
      filters: v.filters,
      grain: v.grain,
      preview: [],
      sql: v.sql_definition,
    },
  };
}

/** Adapt a report to a `mart` {@link LineageNode}. */
export function toReportNode(r: BackendReport): LineageNode {
  return {
    id: r.id,
    label: r.name,
    sub: "mart",
    layer: "mart",
    ref: {
      kind: "report",
      id: r.id,
      name: r.name,
      model: r.name,
      report_type: r.report_type,
      materialization: r.materialization,
      domain: r.domain,
      rows: 0,
      source_refs: r.source_refs,
      preview: [],
      columns_metadata: r.columns_metadata,
      sql: r.sql_definition,
    },
  };
}

/**
 * Assemble the full lineage graph from the four backend lists. Source nodes are
 * the upstream-most roots; staging nodes come from non-archived datasets;
 * intermediate/mart nodes from views/reports. A dataset created from a Source
 * upload carries a `source_id`, yielding a `[source_id, dataset.id]` edge
 * (source → staging); a LEGACY dataset (no `source_id`) stays a root, exactly as
 * before. Each `source_ref` on a view/report yields a `[ref.id, entity.id]` edge.
 */
export function toLineageGraph(
  sources: BackendSource[],
  datasets: BackendDataset[],
  views: BackendView[],
  reports: BackendReport[],
): { nodes: Record<string, LineageNode>; edges: Edge[] } {
  const nodes: Record<string, LineageNode> = {};
  const edges: Edge[] = [];

  for (const s of sources) {
    nodes[s.id] = toSourceNode(s);
  }

  for (const d of datasets) {
    if (d.archived_at) continue;
    nodes[d.id] = toStagingNode(d);
    if (d.source_id) edges.push([d.source_id, d.id]);
  }

  for (const v of views) {
    nodes[v.id] = toViewNode(v);
    for (const ref of v.source_refs ?? []) {
      edges.push([ref.id, v.id]);
    }
  }

  for (const r of reports) {
    nodes[r.id] = toReportNode(r);
    for (const ref of r.source_refs ?? []) {
      edges.push([ref.id, r.id]);
    }
  }

  return { nodes, edges };
}
