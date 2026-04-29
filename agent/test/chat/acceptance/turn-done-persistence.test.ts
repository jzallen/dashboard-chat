/**
 * dc-x3y.3.1 — Persist tool-call outcomes onto the Stream.io thread before
 * `turn_done` is signalled. Acceptance suite for the worker-side persistence
 * mechanism per ADR-014 (DomainEvent classification) and ADR-015
 * (cross-decision composition with the directive log).
 *
 * Exit criteria covered:
 *   3 — DomainEvents in order on the thread after turn_done.
 *   4 — UI directives are NOT persisted to the thread.
 *   6 — Persistence failure does not block turn_done emission.
 *   plus turn_done order: persistence completes BEFORE turn_done lands on SSE.
 */

import { describe, expect, it, vi } from "vitest";

import type { ChatEvent } from "../../../lib/chat/events";
import { wrapWithTurnDoneAndPersist } from "../../../lib/chat/handleChat";
import type { ThreadEventPersister } from "../../../lib/chat/threadPersister";

function fakeUpstream(lines: string[]): Response {
  const body = lines.map((l) => l + "\n").join("");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function readLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split("\n").filter((l) => l.length > 0);
}

function recordingPersister(): ThreadEventPersister & {
  calls: Array<{ channelId: string; events: ChatEvent[] }>;
} {
  const calls: Array<{ channelId: string; events: ChatEvent[] }> = [];
  return {
    calls,
    async persist(channelId, events) {
      calls.push({ channelId, events: [...events] });
    },
  };
}

describe("dc-x3y.3.1 — turn_done + Stream.io thread persistence", () => {
  it("persists DomainEvents in order onto the thread before turn_done is emitted", async () => {
    // Given a turn whose dispatchers emitted three domain events into the buffer
    const buffer: ChatEvent[] = [
      { type: "transform_applied", transform_id: "t-1", dataset_id: "ds-1", operation: "trim", column: "region" },
      { type: "row_added", dataset_id: "ds-1", row_id: "r-7" },
      { type: "column_renamed", dataset_id: "ds-1", old_name: "first", new_name: "given" },
    ];
    const upstream = fakeUpstream([
      '0:"working"',
      'd:{"finishReason":"stop"}',
    ]);
    const persister = recordingPersister();

    // When the finalization wrapper drains the upstream and flushes turn_done
    const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "channel-abc", persister);
    const lines = await readLines(wrapped);

    // Then the persister was called exactly once with the channel id and the
    // domain events in the order they were emitted, plus turn_done as the
    // checkpoint marker (ADR-014 includes turn_done in the domain set).
    expect(persister.calls).toHaveLength(1);
    expect(persister.calls[0].channelId).toBe("channel-abc");
    expect(persister.calls[0].events.map((e) => e.type)).toEqual([
      "transform_applied",
      "row_added",
      "column_renamed",
      "turn_done",
    ]);

    // And the SSE stream surfaces the dispatcher events + turn_done as a
    // single 8: annotation line at the end of the stream.
    const eightLines = lines.filter((l) => l.startsWith("8:"));
    expect(eightLines).toHaveLength(1);
    const emitted = JSON.parse(eightLines[0].slice(2)) as ChatEvent[];
    expect(emitted.map((e) => e.type)).toEqual([
      "transform_applied",
      "row_added",
      "column_renamed",
      "turn_done",
    ]);
    const turnDone = emitted[emitted.length - 1];
    expect(turnDone).toEqual({ type: "turn_done", reason: "stop" });

    // And the upstream `d:` line is preserved verbatim (SSE behaviour unchanged).
    expect(lines.find((l) => l.startsWith("d:"))).toBe('d:{"finishReason":"stop"}');
  });

  it("does NOT persist UI directives onto the thread (ADR-014: directives are out of replay scope)", async () => {
    // Given a turn whose buffer mixes domain events and UI directives
    const buffer: ChatEvent[] = [
      { type: "sort_directive", column: "region", direction: "asc" },
      { type: "row_added", dataset_id: "ds-1", row_id: "r-1" },
      { type: "filter_directive", column: "region", filters: [] },
      { type: "filters_cleared" },
    ];
    const upstream = fakeUpstream(['d:{"finishReason":"stop"}']);
    const persister = recordingPersister();

    const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "channel-abc", persister);
    await readLines(wrapped);

    // Then only the domain events (row_added + the synthesized turn_done) reach the persister.
    expect(persister.calls).toHaveLength(1);
    expect(persister.calls[0].events.map((e) => e.type)).toEqual([
      "row_added",
      "turn_done",
    ]);
    // And no directive variant ever appears in the persisted batch.
    for (const call of persister.calls) {
      for (const event of call.events) {
        expect(["sort_directive", "filter_directive", "filters_cleared"]).not.toContain(event.type);
      }
    }
  });

  it("emits turn_done on the SSE stream even when the persister rejects (best-effort durability)", async () => {
    const buffer: ChatEvent[] = [
      { type: "row_added", dataset_id: "ds-1", row_id: "r-1" },
    ];
    const upstream = fakeUpstream(['d:{"finishReason":"stop"}']);
    const failingPersister: ThreadEventPersister = {
      persist: vi.fn().mockRejectedValue(new Error("Stream.io is down")),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "channel-abc", failingPersister);
      const lines = await readLines(wrapped);

      // turn_done still lands on the SSE stream — the user-facing turn is not blocked.
      const eightLine = lines.find((l) => l.startsWith("8:"));
      expect(eightLine).toBeDefined();
      const events = JSON.parse(eightLine!.slice(2)) as ChatEvent[];
      expect(events.some((e) => e.type === "turn_done")).toBe(true);
      // And the failure is logged (so operators can see it).
      expect(failingPersister.persist).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skips persistence when no channel id is supplied but still emits turn_done", async () => {
    const buffer: ChatEvent[] = [
      { type: "row_added", dataset_id: "ds-1", row_id: "r-1" },
    ];
    const upstream = fakeUpstream(['d:{"finishReason":"stop"}']);
    const persister = recordingPersister();

    const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "", persister);
    const lines = await readLines(wrapped);

    expect(persister.calls).toHaveLength(0);
    const eightLine = lines.find((l) => l.startsWith("8:"));
    expect(eightLine).toBeDefined();
    const events = JSON.parse(eightLine!.slice(2)) as ChatEvent[];
    expect(events[events.length - 1]).toEqual({ type: "turn_done", reason: "stop" });
  });

  it("skips persistence when the buffer has no domain events (UI-directive-only turn)", async () => {
    const buffer: ChatEvent[] = [
      { type: "sort_directive", column: "region", direction: "asc" },
    ];
    const upstream = fakeUpstream(['d:{"finishReason":"stop"}']);
    const persister = recordingPersister();

    const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "channel-abc", persister);
    const lines = await readLines(wrapped);

    // turn_done IS a domain event — even a UI-only turn ends up persisting [turn_done].
    expect(persister.calls).toHaveLength(1);
    expect(persister.calls[0].events.map((e) => e.type)).toEqual(["turn_done"]);
    // The SSE stream still carries the UI directive + turn_done in order.
    const eightLine = lines.find((l) => l.startsWith("8:"));
    const events = JSON.parse(eightLine!.slice(2)) as ChatEvent[];
    expect(events.map((e) => e.type)).toEqual(["sort_directive", "turn_done"]);
  });

  it("maps the upstream finishReason onto the turn_done reason (stop, length, error)", async () => {
    const cases: Array<{ raw: string; reason: "stop" | "length" | "error" }> = [
      { raw: "stop", reason: "stop" },
      { raw: "length", reason: "length" },
      { raw: "tool-calls", reason: "stop" },
      { raw: "error", reason: "error" },
    ];

    for (const { raw, reason } of cases) {
      const buffer: ChatEvent[] = [];
      const upstream = fakeUpstream([`d:${JSON.stringify({ finishReason: raw })}`]);
      const persister = recordingPersister();
      const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "ch", persister);
      const lines = await readLines(wrapped);
      const events = JSON.parse(lines.find((l) => l.startsWith("8:"))!.slice(2)) as ChatEvent[];
      const turnDone = events.find((e) => e.type === "turn_done");
      expect(turnDone).toEqual({ type: "turn_done", reason });
    }
  });

  it("does NOT emit turn_done or persist when the upstream finishReason is 'request' (resolve_dataset pause)", async () => {
    // The resolve_dataset interception rewrites the d: line to finishReason="request".
    // The turn is pausing for FE data resolution; the FE keeps its thinking indicator
    // up while it fetches and re-submits, so emitting turn_done here would prematurely
    // clear that indicator (and would record an incomplete turn on the thread).
    const buffer: ChatEvent[] = [];
    const upstream = fakeUpstream([
      'r:{"type":"resolve_dataset","params":{"name":"patients"}}',
      'd:{"finishReason":"request"}',
    ]);
    const persister = recordingPersister();

    const wrapped = wrapWithTurnDoneAndPersist(upstream, buffer, "channel-abc", persister);
    const lines = await readLines(wrapped);

    // No turn_done annotation on the SSE stream.
    expect(lines.find((l) => l.startsWith("8:"))).toBeUndefined();
    // No persistence call — the turn isn't complete.
    expect(persister.calls).toHaveLength(0);
    // The upstream r: + d: lines pass through unchanged.
    expect(lines).toContain('r:{"type":"resolve_dataset","params":{"name":"patients"}}');
    expect(lines).toContain('d:{"finishReason":"request"}');
  });
});
