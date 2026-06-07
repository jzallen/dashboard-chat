// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import * as uc from "./useCatalog";

describe("initCatalog", () => {
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
