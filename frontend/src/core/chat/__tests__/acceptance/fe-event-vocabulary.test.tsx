/**
 * Frontend chat event vocabulary acceptance suite — see fe-event-vocabulary.feature.
 *
 * Story 2 / AC2.1, AC2.2, AC2.3, AC2.4
 * Story 3 / AC3.1, AC3.2, AC3.3
 * KPI K3 (test wall-clock < 100ms per scenario; soft assertion only)
 *
 * Skipped until each PR lands. Polecat un-skips and implements.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChatEventSchema as FrontendSchema } from "../events";
import { applyDirective } from "../dispatcher";
import { handleChatEvent } from "../eventHandler";
import { MockSSESource } from "../mockSSESource";

// NOTE: cross-workspace import to ../agent/lib/chat/events is resolved by the
// PR-0 polecat per TWD-8 (verbatim duplicate / re-export / shared workspace).
// The "schemas-equivalent" scenario below uses FrontendSchema only until that
// decision is locked.

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

describe.skip("PR 0 — MockSSESource contract", () => {
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

  it("assistant_text_delta accumulates into the chat panel's transcript", () => {
    expect.fail("PR 0 polecat implements (chat panel test that mounts component + drives MockSSESource).");
  });

  it("agent's ChatEventSchema and frontend's ChatEventSchema parse every variant identically", () => {
    // Given a sample of every event variant in the vocabulary
    const samples = [
      { type: "assistant_text_delta", delta: "hi" },
      { type: "transform_applied", transform_id: "t-1", dataset_id: "d-1", operation: "trim", column: "region" },
      { type: "filters_cleared" },
      { type: "turn_done", reason: "stop" },
    ];
    // Polecat at PR 0 wires the AgentSchema import per TWD-8 and asserts
    // expect(AgentSchema.parse(sample)).toEqual(FrontendSchema.parse(sample))
    // for each sample.
    for (const sample of samples) {
      expect(() => FrontendSchema.parse(sample)).not.toThrow();
    }
    expect.fail("PR 0 polecat completes the cross-schema equivalence assertion (TWD-8).");
  });
});

// ---- PR 1: cleaning event reactions --------------------------------------

describe.skip("PR 1 — cleaning event reactions", () => {
  it("transform_applied invalidates the dataset detail query", () => {
    expect.fail("PR 1 polecat implements (uses spied invalidateQueries).");
  });

  it("error_occurred triggers a toast with the event's message", () => {
    expect.fail("PR 1 polecat implements.");
  });

  it("turn_done clears the chat panel \"thinking\" indicator", () => {
    expect.fail("PR 1 polecat implements (chat panel mount + state assertion).");
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
