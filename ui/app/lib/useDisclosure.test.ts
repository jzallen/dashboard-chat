// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDisclosure } from "./useDisclosure";

describe("useDisclosure", () => {
  it("starts closed and opens / closes on show / hide", () => {
    const { result } = renderHook(() => useDisclosure());
    expect(result.current.open).toBe(false);

    act(() => result.current.show());
    expect(result.current.open).toBe(true);

    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
  });

  it("honours an initial-open argument and toggles", () => {
    const { result } = renderHook(() => useDisclosure(true));
    expect(result.current.open).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
  });

  it("keeps stable callback identities across renders", () => {
    const { result, rerender } = renderHook(() => useDisclosure());
    const first = result.current;
    rerender();
    expect(result.current.show).toBe(first.show);
    expect(result.current.hide).toBe(first.hide);
    expect(result.current.toggle).toBe(first.toggle);
  });
});
