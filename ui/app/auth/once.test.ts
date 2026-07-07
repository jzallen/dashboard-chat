import { describe, expect, it, vi } from "vitest";

import { once } from "./once";

describe("once", () => {
  it("runs the wrapped fn on the first call only", () => {
    const fn = vi.fn();
    const latch = once(fn);

    latch.run();
    latch.run();
    latch.run();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("forwards arguments on the firing call", () => {
    const fn = vi.fn();
    const latch = once<[string, number]>(fn);

    latch.run("a", 1);

    expect(fn).toHaveBeenCalledWith("a", 1);
  });

  it("re-arms after reset so the next run fires again", () => {
    const fn = vi.fn();
    const latch = once(fn);

    latch.run();
    latch.reset();
    latch.run();

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
