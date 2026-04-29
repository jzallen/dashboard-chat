// @vitest-environment happy-dom
/**
 * Frontend chat event vocabulary acceptance suite — see fe-event-vocabulary.feature.
 *
 * Story 2 / AC2.1, AC2.2, AC2.3, AC2.4
 * Story 3 / AC3.1, AC3.2, AC3.3
 * KPI K3 (test wall-clock < 100ms per scenario; soft assertion only)
 *
 * Skipped until each PR lands. Polecat un-skips and implements.
 *
 * The shared core-chat vitest config uses environment: "node" for speed.
 * The PR-0 transcript test renders <ChatTranscript> via @testing-library/react,
 * which needs a DOM — a file-level happy-dom override scopes the slower
 * environment to this single suite. Previously masked by the cross-package
 * import failure (dc-bj2.1 F1).
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Cross-package drift between this file's sibling events.ts and
// agent/lib/chat/events.ts is caught by agent/test/chat/schema-sync.test.ts
// (a verbatim-duplicate text check). This suite verifies that the frontend
// schema accepts every variant in the chat event vocabulary; running it
// alongside the sync test transitively guarantees the agent schema accepts
// the same set. The structural coupling is the F1 surgical unblock for
// dc-bj2.1; F2 (dc-bj2.2) replaces the duplication with shared/chat SSOT.

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

  it("frontend's ChatEventSchema accepts every variant in the chat event vocabulary", () => {
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
    // The frontend schema is a re-export of @dashboard-chat/shared-chat/events,
    // the same module imported by agent/lib/chat/events.ts. Both surfaces share
    // a single source of truth (no drift possible) — see shared/chat/events.ts.
    for (const sample of samples) {
      const parsed = FrontendSchema.parse(sample);
      expect(parsed).toEqual(sample);
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

describe("PR 2 — mutation event reactions", () => {
  it("row_added invalidates the dataset detail query", () => {
    const ctx = makeCtx();
    handleChatEvent(
      { type: "row_added", dataset_id: "ds-9", row_id: "row-1" },
      ctx,
    );
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: datasetKeys.detail("ds-9"),
    });
  });

  it("column_renamed invalidates the dataset detail query", () => {
    const ctx = makeCtx();
    handleChatEvent(
      {
        type: "column_renamed",
        dataset_id: "ds-9",
        old_name: "first_name",
        new_name: "Given Name",
      },
      ctx,
    );
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: datasetKeys.detail("ds-9"),
    });
  });

  it.each([
    ["disable", "tf-1"],
    ["delete", "tf-2"],
  ] as const)(
    "transform_undone (mode=%s) invalidates the dataset detail query",
    (mode, transformId) => {
      const ctx = makeCtx();
      handleChatEvent(
        {
          type: "transform_undone",
          dataset_id: "ds-9",
          transform_id: transformId,
          mode,
        },
        ctx,
      );
      expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
      expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: datasetKeys.detail("ds-9"),
      });
    },
  );

  it("transform_re_enabled invalidates the dataset detail query", () => {
    const ctx = makeCtx();
    handleChatEvent(
      { type: "transform_re_enabled", dataset_id: "ds-9", transform_id: "tf-1" },
      ctx,
    );
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("row_deleted invalidates the dataset detail query", () => {
    const ctx = makeCtx();
    handleChatEvent(
      { type: "row_deleted", dataset_id: "ds-9", row_id: "row-1" },
      ctx,
    );
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: datasetKeys.detail("ds-9"),
    });
  });
});

// ---- PR 3: UI directive event reactions ----------------------------------

describe("PR 3 — UI directive event reactions via shared applyDirective", () => {
  it("sort_directive applies sort via the shared dispatcher", () => {
    // Given a TableApi whose setSorting is spied
    const setSorting = vi.fn();
    const ctx = makeCtx({
      table: {
        setSorting,
        setColumnFilters: vi.fn(),
        resetColumnFilters: vi.fn(),
      },
    });
    // When handleChatEvent processes a sort_directive
    handleChatEvent(
      { type: "sort_directive", column: "region", direction: "desc" },
      ctx,
    );
    // Then setSorting was called with the TanStack-shaped descriptor
    expect(setSorting).toHaveBeenCalledTimes(1);
    expect(setSorting).toHaveBeenCalledWith([{ id: "region", desc: true }]);
  });

  it("filter_directive merges into existing column filters via shared dispatcher", () => {
    // Given a TableApi whose setColumnFilters is spied
    const setColumnFilters = vi.fn();
    const ctx = makeCtx({
      table: {
        setSorting: vi.fn(),
        setColumnFilters,
        resetColumnFilters: vi.fn(),
      },
    });
    // When handleChatEvent processes a filter_directive
    handleChatEvent(
      {
        type: "filter_directive",
        column: "region",
        filters: [{ operator: "equals", value: "West" }],
      },
      ctx,
    );
    // Then setColumnFilters was called with an updater function
    expect(setColumnFilters).toHaveBeenCalledTimes(1);
    const updater = setColumnFilters.mock.calls[0][0] as (
      prev: { id: string; value: unknown }[],
    ) => { id: string; value: unknown }[];
    // And the updater upserts the column's filters, preserving other columns
    const next = updater([{ id: "amount", value: { operator: "gt", value: 5 } }]);
    expect(next).toEqual([
      { id: "amount", value: { operator: "gt", value: 5 } },
      { id: "region", value: [{ operator: "equals", value: "West" }] },
    ]);
  });

  it("filters_cleared resets all column filters via shared dispatcher", () => {
    // Given a TableApi whose resetColumnFilters is spied
    const resetColumnFilters = vi.fn();
    const ctx = makeCtx({
      table: {
        setSorting: vi.fn(),
        setColumnFilters: vi.fn(),
        resetColumnFilters,
      },
    });
    // When handleChatEvent processes a filters_cleared event
    handleChatEvent({ type: "filters_cleared" }, ctx);
    // Then resetColumnFilters was called exactly once
    expect(resetColumnFilters).toHaveBeenCalledTimes(1);
  });

  it("Column-header sort click calls the same dispatcher as sort_directive", () => {
    // Given a single TableApi shared by both paths
    const table: TableApi = {
      setSorting: vi.fn(),
      setColumnFilters: vi.fn(),
      resetColumnFilters: vi.fn(),
    };
    // When the chat-driven sort_directive arrives
    handleChatEvent(
      { type: "sort_directive", column: "region", direction: "asc" },
      makeCtx({ table }),
    );
    // And the click-driven path calls applyDirective with the same descriptor
    applyDirective(
      { kind: "sort", column: "region", direction: "asc" },
      table,
    );
    // Then both paths produced the same setSorting call (convergence point)
    expect(table.setSorting).toHaveBeenCalledTimes(2);
    expect(table.setSorting).toHaveBeenNthCalledWith(1, [
      { id: "region", desc: false },
    ]);
    expect(table.setSorting).toHaveBeenNthCalledWith(2, [
      { id: "region", desc: false },
    ]);
  });
});

// ---- AC2.1 exhaustiveness — TS-level test --------------------------------

describe("AC2.1 — exhaustiveness via TS types", () => {
  it("handleChatEvent compiles only when every ChatEvent variant has a case", () => {
    // Compile-time exhaustiveness is enforced by the `const _exhaustive: never
    // = event` line in eventHandler.ts. If a new ChatEvent variant lands
    // without a matching case, TS narrowing fails and the build breaks.
    // Runtime sanity: every variant we know about is dispatched without
    // throwing.
    const ctx = makeCtx();
    const samples: Parameters<typeof handleChatEvent>[0][] = [
      { type: "assistant_text_delta", delta: "hi" },
      {
        type: "transform_applied",
        transform_id: "t-1",
        dataset_id: "d-1",
        operation: "trim",
        column: "region",
      },
      { type: "row_added", dataset_id: "d-1", row_id: "r-1" },
      { type: "row_deleted", dataset_id: "d-1", row_id: "r-1" },
      {
        type: "column_renamed",
        dataset_id: "d-1",
        old_name: "a",
        new_name: "b",
      },
      {
        type: "transform_undone",
        transform_id: "t-1",
        dataset_id: "d-1",
        mode: "disable",
      },
      {
        type: "transform_re_enabled",
        transform_id: "t-1",
        dataset_id: "d-1",
      },
      { type: "sort_directive", column: "region", direction: "asc" },
      { type: "filter_directive", column: "region", filters: [] },
      { type: "filters_cleared" },
      {
        type: "error_occurred",
        phase: "backend_dispatch",
        message: "boom",
        retryable: false,
      },
      { type: "turn_done", reason: "stop" },
    ];
    for (const sample of samples) {
      expect(() => handleChatEvent(sample, ctx)).not.toThrow();
    }
    expect(typeof handleChatEvent).toBe("function");
    expect(typeof applyDirective).toBe("function");
  });
});
