import { describe, expect, it } from "vitest";

import type {
  BackendDataset,
  BackendReport,
  BackendSource,
  BackendView,
} from "./lineageMappers";
import {
  toFields,
  toLineageGraph,
  toReportNode,
  toSourceNode,
  toStagingNode,
  toViewNode,
} from "./lineageMappers";

const source = (over: Partial<BackendSource> = {}): BackendSource => ({
  id: "s1",
  name: "orders_csv",
  schema_config: { fields: { order_id: { type: "integer" }, total: { type: "number" } } },
  ...over,
});

const dataset = (over: Partial<BackendDataset> = {}): BackendDataset => ({
  id: "d1",
  name: "customers",
  display_name: "Customers",
  schema_config: { fields: { email: { type: "text" }, age: { type: "integer" } } },
  transforms: [{ id: "t1" }],
  preview_rows: [{ email: "a@b.com" }],
  row_count: 42,
  staging_sql: "SELECT * FROM raw_customers",
  ...over,
});

const view = (over: Partial<BackendView> = {}): BackendView => ({
  id: "v1",
  name: "active_customers",
  sql_definition: "SELECT * FROM customers WHERE active",
  source_refs: [{ id: "d1", type: "dataset" }],
  columns: [{ name: "email" }],
  joins: [{ left_ref: "d1" }],
  filters: [{ column: "active" }],
  grain: { time_column: "created_at", dimensions: [] },
  materialization: "view",
  ...over,
});

const report = (over: Partial<BackendReport> = {}): BackendReport => ({
  id: "r1",
  name: "revenue",
  sql_definition: "SELECT sum(amount) FROM active_customers",
  report_type: "fact",
  source_refs: [{ id: "v1", type: "view" }],
  domain: "finance",
  columns_metadata: [{ name: "amount", semantic_role: "measure" }],
  materialization: "table",
  ...over,
});

describe("toFields", () => {
  it("reads the NESTED schema_config.fields into flat FieldDefs", () => {
    expect(
      toFields({ fields: { email: { type: "text" }, age: { type: "integer" } } }),
    ).toEqual([
      { name: "email", type: "text" },
      { name: "age", type: "integer" },
    ]);
  });

  it("returns [] for an empty / absent schema_config", () => {
    expect(toFields({})).toEqual([]);
    expect(toFields(undefined)).toEqual([]);
    expect(toFields({ fields: {} })).toEqual([]);
  });

  it("defaults a missing field type to 'text'", () => {
    expect(toFields({ fields: { x: {} } })).toEqual([{ name: "x", type: "text" }]);
  });
});

describe("toStagingNode", () => {
  it("maps a dataset to a staging node with a dataset ref", () => {
    const node = toStagingNode(dataset());
    expect(node.id).toBe("d1");
    expect(node.layer).toBe("staging");
    expect(node.sub).toBe("staging");
    expect(node.ref?.kind).toBe("dataset");
    expect(node.ref?.sql).toBe("SELECT * FROM raw_customers");
    expect(node.ref?.rows).toBe(42);
    expect(node.ref?.fields).toEqual([
      { name: "email", type: "text" },
      { name: "age", type: "integer" },
    ]);
    expect(node.ref?.model).toBe("customers");
  });

  it("prefers display_name over name for the label and ref.name", () => {
    const node = toStagingNode(dataset({ display_name: "Pretty", name: "raw" }));
    expect(node.label).toBe("Pretty");
    expect(node.ref?.name).toBe("Pretty");
    expect(node.ref?.model).toBe("raw");
  });

  it("falls back to name when display_name is absent", () => {
    const node = toStagingNode(dataset({ display_name: null }));
    expect(node.label).toBe("customers");
  });

  it("maps model_name onto the node's modelName (the read-only stg_ machine name)", () => {
    const node = toStagingNode(dataset({ model_name: "stg_customers" }));
    expect(node.modelName).toBe("stg_customers");
  });

  it("leaves modelName undefined for a legacy row without model_name", () => {
    expect(toStagingNode(dataset({ model_name: null })).modelName).toBeUndefined();
    expect(toStagingNode({ id: "d2", name: "bare" }).modelName).toBeUndefined();
  });

  it("does NOT set a top-level schema (staging refs carry fields)", () => {
    expect(toStagingNode(dataset()).schema).toBeUndefined();
  });

  it("defaults transforms/preview/rows/sql when the list path omits them", () => {
    const node = toStagingNode({ id: "d2", name: "bare" });
    expect(node.ref?.transforms).toEqual([]);
    expect(node.ref?.preview).toEqual([]);
    expect(node.ref?.rows).toBe(0);
    expect(node.ref?.sql).toBe("");
    expect(node.ref?.fields).toEqual([]);
  });
});

describe("toViewNode", () => {
  it("maps a view to an intermediate node with a view ref", () => {
    const node = toViewNode(view());
    expect(node.id).toBe("v1");
    expect(node.layer).toBe("intermediate");
    expect(node.sub).toBe("intermediate");
    expect(node.ref?.kind).toBe("view");
    expect(node.ref?.sql).toBe("SELECT * FROM customers WHERE active");
    expect(node.ref?.rows).toBe(0);
  });

  it("passes columns/joins/filters/grain/source_refs through", () => {
    const node = toViewNode(view());
    expect(node.ref?.columns).toEqual([{ name: "email" }]);
    expect(node.ref?.joins).toEqual([{ left_ref: "d1" }]);
    expect(node.ref?.filters).toEqual([{ column: "active" }]);
    expect(node.ref?.grain).toEqual({ time_column: "created_at", dimensions: [] });
    expect(node.ref?.source_refs).toEqual([{ id: "d1", type: "dataset" }]);
  });
});

describe("toReportNode", () => {
  it("maps a report to a mart node with a report ref", () => {
    const node = toReportNode(report());
    expect(node.id).toBe("r1");
    expect(node.layer).toBe("mart");
    expect(node.sub).toBe("mart");
    expect(node.ref?.kind).toBe("report");
    expect(node.ref?.sql).toBe("SELECT sum(amount) FROM active_customers");
    expect(node.ref?.rows).toBe(0);
  });

  it("passes report_type/domain/columns_metadata/source_refs through", () => {
    const node = toReportNode(report());
    expect(node.ref?.report_type).toBe("fact");
    expect(node.ref?.domain).toBe("finance");
    expect(node.ref?.columns_metadata).toEqual([
      { name: "amount", semantic_role: "measure" },
    ]);
    expect(node.ref?.source_refs).toEqual([{ id: "v1", type: "view" }]);
  });
});

describe("toSourceNode", () => {
  it("maps a backend source to a source-layer node", () => {
    const node = toSourceNode(source());
    expect(node.id).toBe("s1");
    expect(node.label).toBe("orders_csv");
    expect(node.layer).toBe("source");
    expect(node.sub).toBe("source");
  });

  it("sets the top-level schema from schema_config (no ref)", () => {
    const node = toSourceNode(source());
    expect(node.schema).toEqual([
      { name: "order_id", type: "integer" },
      { name: "total", type: "number" },
    ]);
    expect(node.ref).toBeUndefined();
  });

  it("defaults files to [] (per-source upload list is a later enhancement)", () => {
    expect(toSourceNode(source()).files).toEqual([]);
  });

  it("defaults schema to [] for a source with no schema_config yet", () => {
    expect(toSourceNode(source({ schema_config: undefined })).schema).toEqual([]);
  });
});

describe("toLineageGraph", () => {
  it("keys the node map by id across all four entity kinds", () => {
    const { nodes } = toLineageGraph(
      [source()],
      [dataset({ source_id: "s1" })],
      [view()],
      [report()],
    );
    expect(Object.keys(nodes).sort()).toEqual(["d1", "r1", "s1", "v1"]);
    expect(nodes.s1.layer).toBe("source");
    expect(nodes.d1.layer).toBe("staging");
    expect(nodes.v1.layer).toBe("intermediate");
    expect(nodes.r1.layer).toBe("mart");
  });

  it("derives a [source_id, dataset.id] edge from a dataset's source link", () => {
    const { edges } = toLineageGraph(
      [source()],
      [dataset({ source_id: "s1" })],
      [],
      [],
    );
    expect(edges).toContainEqual(["s1", "d1"]); // source → staging
  });

  it("derives view/report edges [source_ref.id, entity.id] upstream→downstream", () => {
    const { edges } = toLineageGraph([], [dataset()], [view()], [report()]);
    expect(edges).toContainEqual(["d1", "v1"]); // dataset → view
    expect(edges).toContainEqual(["v1", "r1"]); // view → report
    for (const [from, to] of edges) {
      expect([from, to]).toHaveLength(2);
    }
  });

  it("keeps a legacy dataset WITHOUT a source_id as a root (no source edge)", () => {
    const { nodes, edges } = toLineageGraph([], [dataset()], [], []);
    expect(nodes.d1).toBeDefined();
    expect(nodes.d1.layer).toBe("staging");
    // no edge pointing INTO the dataset
    expect(edges.some(([, to]) => to === "d1")).toBe(false);
  });

  it("excludes an archived dataset from the active nodes", () => {
    const { nodes } = toLineageGraph(
      [],
      [dataset(), dataset({ id: "d9", archived_at: "2026-01-01" })],
      [],
      [],
    );
    expect(nodes.d1).toBeDefined();
    expect(nodes.d9).toBeUndefined();
  });

  it("maps archived datasets into coldRecords with retiredAt and retentionDays", () => {
    const archivedAt = "2026-03-01T12:00:00Z";
    const { coldRecords } = toLineageGraph(
      [source()],
      [
        dataset({ source_id: "s1" }),
        dataset({ id: "d9", name: "archived_csv", archived_at: archivedAt, source_id: "s1" }),
      ],
      [],
      [],
    );
    expect(coldRecords).toHaveLength(1);
    const rec = coldRecords[0];
    expect(rec.node.id).toBe("d9");
    expect(rec.node.layer).toBe("staging");
    expect(rec.retiredAt).toBe(Date.parse(archivedAt));
    expect(rec.retentionDays).toBe(90);
    // The incident edge from source_id is carried so restore can re-wire it.
    expect(rec.edges).toContainEqual(["s1", "d9"]);
  });

  it("returns empty coldRecords when no datasets are archived", () => {
    const { coldRecords } = toLineageGraph([], [dataset()], [], []);
    expect(coldRecords).toEqual([]);
  });

  it("handles views/reports with no source_refs (no edges)", () => {
    const { edges } = toLineageGraph(
      [],
      [dataset()],
      [view({ source_refs: undefined })],
      [report({ source_refs: undefined })],
    );
    expect(edges).toEqual([]);
  });

  it("returns empty nodes + edges for empty inputs", () => {
    const { nodes, edges, coldRecords } = toLineageGraph([], [], [], []);
    expect(nodes).toEqual({});
    expect(edges).toEqual([]);
    expect(coldRecords).toEqual([]);
  });
});
