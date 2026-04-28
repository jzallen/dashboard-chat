/**
 * Frontend chat event vocabulary acceptance suite — see fe-event-vocabulary.feature.
 *
 * Story 2 / AC2.1, AC2.2, AC2.3, AC2.4
 * Story 3 / AC3.1, AC3.2, AC3.3
 * KPI K3 (test wall-clock < 100ms per scenario; soft assertion only)
 *
 * Skipped until each PR lands. Polecat un-skips and implements.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatEventSchema as AgentSchema } from "../../../../../../agent/lib/chat/events";
import { datasetKeys } from "../../../../lib/queryKeys";
import { ChatTranscript } from "../../ChatTranscript";
import { applyDirective, type TableApi } from "../../dispatcher";
import { type EventHandlerContext, handleChatEvent } from "../../eventHandler";
import { ChatEventSchema as FrontendSchema } from "../../events";
import { MockSSESource } from "../mockSSESource";

function makeCtx(overrides?: Partial<EventHandlerContext>): EventHandlerContext {
  const noopTable: TableApi = {
    setSorting: () => {},
    setColumnFilters: () => {},
    resetColumnFilters: () => {},
  };
  return {
    queryClient: { invalidateQueries: vi.fn() },
    table: noopTable,
    toast: { error: vi.fn(), success: vi.fn() },
    thinking: { setVisible: vi.fn() },
    ...overrides,
  };
}

// Cross-workspace import to ../agent/lib/chat/events resolved per TWD-8 option 1
// (verbatim duplicate). The cross-schema sync scenario asserts that both
// schemas parse every variant identically — the polecat-time check that catches
// future drift.

// Soft K3 perf check — prints only, never fails (TWD-11).
let _start = 0;
beforeEach(() => { _start = performance.now(); });
afterEach(() => {
  const dur = performance.now() - _start;
  if (dur > 100) {
    // eslint-disable-next-line no-console
    console.log(`[K3] slow scenario: ${dur.toFixed(1)}ms`);
  }
});

// ---- PR 0: MockSSESource contract + schema sync --------------------------

describe("PR 0 — MockSSESource contract", () => {
  it("MockSSESource synchronously delivers emit() to all subscribers", () => {
    // Given a MockSSESource with two subscribers
    const source = new MockSSESource();
    const seen1: unknown[] = [];
    const seen2: unknown[] = [];
    source.subscribe((e) => seen1.push(e));
    source.subscribe((e) => seen2.push(e));
    // When emit() is called once with a transform_applied event
    const ev = { type: "transform_applied", transform_id: "t-1", dataset_id: "ds-1", operation: "trim", column: "region" } as never;
    source.emit(ev);
    // Then both subscriber callbacks were invoked exactly once / each received the same event
    expect(seen1).toEqual([ev]);
    expect(seen2).toEqual([ev]);
  });

  it("MockSSESource.emitSequence preserves order", async () => {
    const source = new MockSSESource();
    const seen: unknown[] = [];
    source.subscribe((e) => seen.push(e));
    const evs = [
      { type: "assistant_text_delta", delta: "a" },
      { type: "assistant_text_delta", delta: "b" },
      { type: "turn_done", reason: "stop" },
    ] as never[];
    await source.emitSequence(evs);
    expect(seen).toEqual(evs);
  });

  it("MockSSESource subscribe returns an unsubscribe function", () => {
    const source = new MockSSESource();
    let count = 0;
    const unsub = source.subscribe(() => count++);
    unsub();
    source.emit({ type: "turn_done", reason: "stop" } as never);
    expect(count).toBe(0);
  });

  it("assistant_text_delta accumulates into the chat panel's transcript", async () => {
    // Given a chat transcript component mounted with a MockSSESource
    const source = new MockSSESource();
    render(<ChatTranscript source={source} />);
    const transcript = screen.getByTestId("chat-transcript");
    expect(transcript.textContent).toBe("");
    // When two assistant_text_delta events are emitted in order
    await act(async () => {
      await source.emitSequence([
        { type: "assistant_text_delta", delta: "Hello, " },
        { type: "assistant_text_delta", delta: "world!" },
      ]);
    });
    // Then the transcript reflects the accumulated text in order
    await waitFor(() => {
      expect(transcript.textContent).toBe("Hello, world!");
    });
  });

  it("agent's ChatEventSchema and frontend's ChatEventSchema parse every variant identically", () => {
    // Given a sample of every event variant in the vocabulary
    const samples = [
      { type: "assistant_text_delta", delta: "hi" },
      { type: "transform_applied", transform_id: "t-1", dataset_id: "d-1", operation: "trim", column: "region" },
      { type: "column_renamed", dataset_id: "d-1", old_name: "a", new_name: "b" },
      { type: "row_added", dataset_id: "d-1", row_id: "r-1" },
      { type: "row_deleted", dataset_id: "d-1", row_id: "r-1" },
      { type: "transform_undone", transform_id: "t-1", dataset_id: "d-1", mode: "disable" },
      { type: "transform_re_enabled", transform_id: "t-1", dataset_id: "d-1" },
      { type: "sort_directive", column: "region", direction: "asc" },
      { type: "filter_directive", column: "region", filters: [] },
      { type: "filters_cleared" },
      { type: "error_occurred", phase: "backend_dispatch", message: "boom", retryable: false },
      { type: "turn_done", reason: "stop" },
    ];
    // Then both schemas accept every sample, and the parsed shapes match.
    for (const sample of samples) {
      const frontendParsed = FrontendSchema.parse(sample);
      const agentParsed = AgentSchema.parse(sample);
      expect(frontendParsed).toEqual(agentParsed);
    }
  });
});

// ---- PR 1: cleaning event reactions --------------------------------------

describe("PR 1 — cleaning event reactions", () => {
  it("transform_applied invalidates the dataset detail query", () => {
    // Given a context whose queryClient.invalidateQueries is spied
    const ctx = makeCtx();
    // When handleChatEvent processes a transform_applied event for ds-456
    handleChatEvent(
      {
        type: "transform_applied",
        transform_id: "t-123",
        dataset_id: "ds-456",
        operation: "trim",
        column: "region",
      },
      ctx,
    );
    // Then invalidateQueries was called with datasetKeys.detail("ds-456")
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: datasetKeys.detail("ds-456"),
    });
  });

  it("error_occurred triggers a toast with the event's message", () => {
    // Given a context whose toast.error is spied
    const ctx = makeCtx();
    // When handleChatEvent processes an error_occurred event
    handleChatEvent(
      {
        type: "error_occurred",
        phase: "backend_dispatch",
        message: "backend exploded",
        retryable: false,
      },
      ctx,
    );
    // Then toast.error was called with the event's message
    expect(ctx.toast.error).toHaveBeenCalledTimes(1);
    expect(ctx.toast.error).toHaveBeenCalledWith("backend exploded");
  });

  it("turn_done clears the chat panel \"thinking\" indicator", () => {
    // Given a context whose thinking.setVisible is spied
    const ctx = makeCtx();
    // When handleChatEvent processes a turn_done event
    handleChatEvent({ type: "turn_done", reason: "stop" }, ctx);
    // Then thinking.setVisible(false) was called exactly once
    expect(ctx.thinking!.setVisible).toHaveBeenCalledTimes(1);
    expect(ctx.thinking!.setVisible).toHaveBeenCalledWith(false);
  });
});

// ---- PR 2: mutation event reactions --------------------------------------

describe.skip("PR 2 — mutation event reactions", () => {
  it("row_added invalidates the dataset detail query", () => {
    expect.fail("PR 2 polecat implements.");
  });

  it("column_renamed invalidates the dataset detail query", () => {
    expect.fail("PR 2 polecat implements.");
  });
});

// ---- PR 3: UI directive event reactions ----------------------------------

describe.skip("PR 3 — UI directive event reactions via shared applyDirective", () => {
  it("sort_directive applies sort via the shared dispatcher", () => {
    expect.fail("PR 3 polecat implements.");
  });

  it("filter_directive merges into existing column filters via shared dispatcher", () => {
    expect.fail("PR 3 polecat implements.");
  });

  it("filters_cleared resets all column filters via shared dispatcher", () => {
    expect.fail("PR 3 polecat implements.");
  });

  it("Column-header sort click calls the same dispatcher as sort_directive", () => {
    expect.fail("PR 3 polecat implements (proves the convergence point).");
  });
});

// ---- AC2.1 exhaustiveness — TS-level test --------------------------------

describe.skip("AC2.1 — exhaustiveness via TS types", () => {
  it("handleChatEvent compiles only when every ChatEvent variant has a case", () => {
    // This is a TYPE test, not a runtime test. The polecat at PR 0 wires this
    // up via tsd or expectTypeOf. It asserts that handleChatEvent has a
    // `default: const _: never = event` branch and a complete switch.
    // Runtime body below is just a sanity check that the function is callable.
    expect(typeof handleChatEvent).toBe("function");
    expect(typeof applyDirective).toBe("function");
  });
});
