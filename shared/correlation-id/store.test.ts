import { describe, expect, it } from "vitest";

import { getCorrelationId, runWithCorrelationId } from "./store";

describe("correlation-id ambient binding", () => {
  it("binds the id for the whole async tree, surviving an await boundary", async () => {
    const seen = await runWithCorrelationId("corr-abc", async () => {
      await Promise.resolve();
      return getCorrelationId();
    });

    expect(seen).toBe("corr-abc");
  });

  it("reads undefined when no id is bound to the current context", () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it("does not leak a bound id outside the run that established it", () => {
    runWithCorrelationId("corr-inside", () => undefined);

    expect(getCorrelationId()).toBeUndefined();
  });
});
