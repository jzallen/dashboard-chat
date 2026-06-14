// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DataCatalog, LineageNode } from "../../catalog";
import { computeDagLayout, DagDimensionConfig } from "./lineageLayout";

/**
 * Row ordering in the DAG layout must track graph topology, not arbitrary
 * per-layer insertion order. A 1:1 Source→Dataset edge should draw as a
 * straight horizontal line (equal y at both ends); previously each column was
 * ordered by catalog insertion order with no cross-column alignment, so two
 * sources whose datasets were keyed in the opposite order produced an
 * X-crossing. The fix is a barycenter ordering pass (a child sits at the mean
 * row of its parents); for the 1:1 case that collapses to "dataset inherits its
 * source's row".
 */

function node(id: string, layer: LineageNode["layer"]): LineageNode {
  return { id, label: id, sub: layer, layer, ref: {} } as LineageNode;
}

/** Minimal DataCatalog stub exposing only what computeDagLayout consumes. */
function stubCatalog(
  byLayer: Partial<Record<LineageNode["layer"], LineageNode[]>>,
  parents: Record<string, string[]>,
): DataCatalog {
  const index: Record<string, LineageNode> = {};
  for (const nodes of Object.values(byLayer))
    for (const n of nodes ?? []) index[n.id] = n;
  return {
    getNodesByLayer: (layer: LineageNode["layer"]) => byLayer[layer] ?? [],
    parentsOf: (id: string) => (parents[id] ?? []).map((p) => index[p]),
  } as unknown as DataCatalog;
}

describe("computeDagLayout — topology-aware row ordering", () => {
  it("draws a 1:1 Source→Dataset as a straight line even when columns are keyed in opposite order", () => {
    // sources [customers, ecommerce] but datasets returned in the OPPOSITE order
    const catalog = stubCatalog(
      {
        source: [node("customers", "source"), node("ecommerce", "source")],
        staging: [node("ds_ecommerce", "staging"), node("ds_customers", "staging")],
      },
      { ds_customers: ["customers"], ds_ecommerce: ["ecommerce"] },
    );

    const { nodePositions: p } = computeDagLayout(catalog, DagDimensionConfig);

    // Each dataset shares its source's row → flat edge (y1 === y2 in bezierPath).
    expect(p.ds_customers.y).toBe(p.customers.y);
    expect(p.ds_ecommerce.y).toBe(p.ecommerce.y);
  });

  it("orders a downstream column by its parents' barycenter (multi-parent JOIN)", () => {
    // staging rows: customers→0, ecommerce→1 (aligned to sources).
    // intermediate: joinView joins BOTH (barycenter 0.5), soloView has one
    // parent at row 0 (barycenter 0) → soloView must order above joinView.
    const catalog = stubCatalog(
      {
        source: [node("customers", "source"), node("ecommerce", "source")],
        staging: [node("ds_customers", "staging"), node("ds_ecommerce", "staging")],
        intermediate: [
          node("joinView", "intermediate"),
          node("soloView", "intermediate"),
        ],
      },
      {
        ds_customers: ["customers"],
        ds_ecommerce: ["ecommerce"],
        joinView: ["ds_customers", "ds_ecommerce"],
        soloView: ["ds_customers"],
      },
    );

    const { nodePositions: p } = computeDagLayout(catalog, DagDimensionConfig);

    expect(p.soloView.y).toBeLessThan(p.joinView.y);
  });

  it("places a parentless (orphan) node at a valid distinct row after aligned siblings", () => {
    const catalog = stubCatalog(
      {
        source: [node("customers", "source")],
        staging: [node("ds_customers", "staging"), node("ds_orphan", "staging")],
      },
      { ds_customers: ["customers"] },
    );

    const { nodePositions: p } = computeDagLayout(catalog, DagDimensionConfig);

    expect(Number.isFinite(p.ds_orphan.y)).toBe(true);
    expect(p.ds_orphan.y).toBeGreaterThan(p.ds_customers.y);
  });
});
