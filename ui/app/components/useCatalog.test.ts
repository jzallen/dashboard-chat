// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { metadataApiSource } from "../catalog";
import * as uc from "./useCatalog";

// Spy on metadataApiSource while delegating to the real implementation, so we can
// assert the deps useCatalog injects — notably getToken → null now that the
// session rides an httpOnly cookie the catalog can neither read nor forward.
vi.mock("../catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../catalog")>();
  return { ...actual, metadataApiSource: vi.fn(actual.metadataApiSource) };
});

describe("initCatalog — catalog composition", () => {
  it("injects getToken as () => null (the catalog stays decoupled from the cookie session)", async () => {
    await uc.initCatalog();
    expect(metadataApiSource).toHaveBeenCalled();
    const deps = vi.mocked(metadataApiSource).mock.calls[0][0];
    expect(deps.getToken()).toBeNull();
  });

  // Regression: the root loader re-runs initCatalog on every navigation (incl.
  // a `?view=` toggle). If it weren't idempotent, each call would rebuild the
  // catalog from the fixture seed and drop the live project scope — surfacing
  // fallback data after a view switch. A second call must be a no-op.
  it("is idempotent — a second call preserves the catalog instance", async () => {
    await uc.initCatalog();
    const first = uc.catalog;
    expect(first).toBeDefined();

    await uc.initCatalog();
    expect(uc.catalog).toBe(first);
  });
});
