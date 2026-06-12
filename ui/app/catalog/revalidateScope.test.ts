// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createDataCatalog, fixtureSource } from "./index";

/** A fixture-backed primary with spied scope hooks, so we can observe what the
 *  public revalidateScope() drives without a backend. */
function spiedPrimary() {
  const invalidateScope = vi.fn();
  const getCurrentProject = vi.fn(() => fixtureSource.getCurrentProject());
  return {
    primary: { ...fixtureSource, invalidateScope, getCurrentProject },
    invalidateScope,
    getCurrentProject,
  };
}

describe("catalog.revalidateScope()", () => {
  it("is a no-op until a project is scoped", async () => {
    const { primary, invalidateScope } = spiedPrimary();
    const catalog = await createDataCatalog(primary, fixtureSource);

    await catalog.revalidateScope();

    expect(invalidateScope).not.toHaveBeenCalled();
  });

  it("drops the scoped cache and re-runs the scoped getters for the current project", async () => {
    const { primary, invalidateScope, getCurrentProject } = spiedPrimary();
    const catalog = await createDataCatalog(primary, fixtureSource);
    await catalog.selectProject("proj-1");

    invalidateScope.mockClear();
    getCurrentProject.mockClear();

    await catalog.revalidateScope();

    // fresh:true by default → drop the per-project cache for the scoped pid first…
    expect(invalidateScope).toHaveBeenCalledWith("proj-1");
    // …then re-run the project-scoped reads.
    expect(getCurrentProject).toHaveBeenCalled();
  });

  it("honours { fresh:false } for an SWR-style refresh (no cache drop)", async () => {
    const { primary, invalidateScope } = spiedPrimary();
    const catalog = await createDataCatalog(primary, fixtureSource);
    await catalog.selectProject("proj-1");
    invalidateScope.mockClear();

    await catalog.revalidateScope({ fresh: false });

    expect(invalidateScope).not.toHaveBeenCalled();
  });
});
