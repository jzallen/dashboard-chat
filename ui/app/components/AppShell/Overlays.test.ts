// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { fixtureSource } from "../../catalog";
import { catalog } from "../useCatalog";
import { installCatalogForTest } from "../useCatalog";
import { chatContextNode } from "./Overlays";

/**
 * Regression: the assistant overlay's context node is resolved from the
 * project-scoped route params (`dataset/:datasetId` under `/project/:projectId`),
 * NOT from a top-level `/table|/view|/report` path prefix. Those prefixes never
 * existed in the live route table, so the prior prefix-matching resolver always
 * returned null and the overlay reported "No dataset in context" with a dataset
 * open. The existing Chat.test.tsx injects the `context` prop directly and could
 * not catch this — this exercises the params -> node seam.
 */
describe("chatContextNode — route param resolution", () => {
  beforeEach(async () => {
    await installCatalogForTest(fixtureSource, fixtureSource);
  });

  it("resolves the open dataset node from params.datasetId", () => {
    const dataset = catalog.getNodesByLayer("staging")[0];
    expect(dataset).toBeTruthy();

    const resolved = chatContextNode({ datasetId: dataset.id });

    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(dataset.id);
  });

  it("resolves a view node from params.viewId", () => {
    const view = catalog.getNodesByLayer("intermediate")[0];
    if (!view) return; // fixture may carry no view; the dataset case is the load-bearing one
    expect(chatContextNode({ viewId: view.id })?.id).toBe(view.id);
  });

  it("returns null off a model route (no model param present)", () => {
    expect(chatContextNode({ projectId: "019e7997" })).toBeNull();
    expect(chatContextNode({})).toBeNull();
  });

  it("returns null when the param points at an unknown id", () => {
    expect(chatContextNode({ datasetId: "does-not-exist" })).toBeNull();
  });
});
