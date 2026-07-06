// @vitest-environment happy-dom
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LineageNode } from "../../catalog";
import { OpenNodeProvider, useOpenNode } from "./openNodeContext";

const node = {
  id: "n1",
  label: "orders",
  sub: "",
  layer: "source",
} as LineageNode;

describe("useOpenNode", () => {
  it("throws when used outside an OpenNodeProvider", () => {
    expect(() => renderHook(() => useOpenNode())).toThrow(
      /must be used within an OpenNodeProvider/,
    );
  });

  it("delivers the provided callback to a nested consumer", () => {
    const onOpen = vi.fn();
    function Leaf() {
      const open = useOpenNode();
      return <button onClick={() => open(node)}>open</button>;
    }
    render(
      <OpenNodeProvider onOpen={onOpen}>
        <Leaf />
      </OpenNodeProvider>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(onOpen).toHaveBeenCalledWith(node);
  });
});
