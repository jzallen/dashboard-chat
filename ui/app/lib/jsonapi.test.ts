import { describe, expect, it } from "vitest";

import { unwrapEnvelope } from "./jsonapi";

describe("unwrapEnvelope — JSON:API envelope → flat", () => {
  it("flattens a single resource to { id, ...attributes }", () => {
    expect(
      unwrapEnvelope({
        data: { type: "orgs", id: "org-7", attributes: { name: "Acme" } },
      }),
    ).toEqual({ id: "org-7", name: "Acme" });
  });

  it("flattens a collection element-wise", () => {
    expect(
      unwrapEnvelope({
        data: [
          { type: "projects", id: "p1", attributes: { name: "Alpha" } },
          { type: "projects", id: "p2", attributes: { name: "Beta" } },
        ],
      }),
    ).toEqual([
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ]);
  });

  it("maps an empty collection to []", () => {
    expect(unwrapEnvelope({ data: [] })).toEqual([]);
  });

  it("returns a resource lacking `attributes` unchanged (aside from the envelope)", () => {
    expect(unwrapEnvelope({ data: { type: "orgs", id: "org-7" } })).toEqual({
      type: "orgs",
      id: "org-7",
    });
  });

  it("returns a non-envelope value (no `data` key) untouched", () => {
    expect(unwrapEnvelope({ id: "already-flat" })).toEqual({
      id: "already-flat",
    });
    expect(unwrapEnvelope(null)).toBeNull();
  });
});
