// @vitest-environment happy-dom
//
// The async deep-link resolver's state machine: a node id resolves off the
// reactive catalog once a commit lands, times out to `missing` when it never
// appears, and re-arms its bounded timer when the id changes. Fake timers drive
// the timeout boundary deterministically.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineageNode, PartialCatalogSource } from "../catalog";
import { installCatalogForTest, loadTestScope } from "../components/useCatalog";
import { fixtureFallback, fixtureNodes } from "../routes/_fixtureCatalog";
import { useResolvedNode } from "./useResolvedNode";

const RESOLVE_TIMEOUT_MS = 8000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Install a catalog whose graph starts EMPTY (an empty-nodes fallback), so any
 *  id reads `pending` until something commits nodes. */
async function installEmpty(): Promise<void> {
  await installCatalogForTest({}, fixtureFallback({}));
}

describe("useResolvedNode", () => {
  it("reports pending until a catalog commit makes the node appear, then resolved", async () => {
    // Empty fallback graph, plus a primary that supplies d1 on the scoped read —
    // so d1 is absent until the project-layout loader (loadTestScope stands in
    // for it) fetches the primary's nodes and commits them into the catalog.
    const nodes: Record<string, LineageNode> = { d1: fixtureNodes().d1 };
    const primary: PartialCatalogSource = {
      getCurrentProject: () =>
        Promise.resolve({ id: "proj-1", name: "Primary", description: "" }),
      getNodes: () => Promise.resolve(nodes),
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };
    await installCatalogForTest(primary, fixtureFallback({}));

    const { result } = renderHook(() => useResolvedNode("d1"));
    expect(result.current.status).toBe("pending");

    await act(async () => {
      await loadTestScope("proj-1");
    });

    expect(result.current.status).toBe("resolved");
    expect(result.current.node?.id).toBe("d1");
  });

  it("flips pending to missing once the bounded timer elapses for an absent id", async () => {
    await installEmpty();

    const { result } = renderHook(() => useResolvedNode("ghost"));
    expect(result.current.status).toBe("pending");

    act(() => {
      vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS);
    });

    expect(result.current.status).toBe("missing");
  });

  it("re-arms the timer on id change: the prior timer is cleared so the new id gets a full window", async () => {
    await installEmpty();

    const { result, rerender } = renderHook(({ id }) => useResolvedNode(id), {
      initialProps: { id: "ghost-a" },
    });

    // Almost time out the first id, then switch — the switch must clear the old
    // timer and start a fresh one, so the new id is NOT declared missing early.
    act(() => {
      vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS - 1);
    });
    rerender({ id: "ghost-b" });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe("pending");

    // Only after a full fresh window does the new id resolve to missing.
    act(() => {
      vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS);
    });
    expect(result.current.status).toBe("missing");
  });
});
