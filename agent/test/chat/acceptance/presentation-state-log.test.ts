/**
 * Acceptance tests for the worker side of the reflect-only directive log
 * (ADR-015 / dc-x3y.2.2).
 *
 *   - UI dispatchers append the emitted UiDirective to ctx.presentationState
 *     as a side effect of `emit`.
 *   - The append is on a different side channel from BackendClient.post —
 *     the worker invariant at worker-tool-dispatch.test.ts:502-550 is
 *     preserved (UI dispatchers do not call backend.post).
 *   - When channelId is empty (legacy /chat callers without thread_id), the
 *     dispatcher emits but does not append — no anonymous bucket.
 */

import { describe, expect, it, vi } from "vitest";

import type { BackendClient } from "../../../lib/chat/backend-client";
import type { DispatchContext } from "../../../lib/chat/dispatchers";
import {
  makeClearFiltersDispatcher,
  makeFilterTableDispatcher,
  makeReplaceColumnFiltersDispatcher,
  makeSortTableDispatcher,
} from "../../../lib/chat/dispatchers/ui";
import type { ChatEvent } from "../../../lib/chat/events";
import { InProcessPresentationStateLog } from "../../../lib/chat/presentationState";

type ToolWithExecute = {
  execute: (
    input: Record<string, unknown>,
    options: { toolCallId: string; messages: unknown[] },
  ) => Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
};

function callExecute(
  tool: unknown,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> & { ok: boolean; error?: string }> {
  return (tool as ToolWithExecute).execute(input, {
    toolCallId: "tc-test",
    messages: [],
  });
}

function buildContext(opts: {
  channelId: string;
  log: InProcessPresentationStateLog;
}): { ctx: DispatchContext; events: ChatEvent[]; backend: BackendClient } {
  const events: ChatEvent[] = [];
  const backend: BackendClient = {
    post: vi.fn(async () => {
      throw new Error("UI dispatcher must not call backend");
    }),
    get: vi.fn(),
  };
  const ctx: DispatchContext = {
    jwt: "test.jwt",
    datasetId: "ds-1",
    projectId: undefined,
    contextType: "dataset",
    backend,
    emit: (e) => events.push(e),
    channelId: opts.channelId,
    presentationState: opts.log,
  };
  return { ctx, events, backend };
}

describe("UI dispatchers append to the per-channel directive log (ADR-015)", () => {
  it("sortTable appends sort_directive to the log AND emits on SSE", async () => {
    const log = new InProcessPresentationStateLog(
      () => new Date("2026-04-29T05:00:00Z"),
    );
    const { ctx, events, backend } = buildContext({ channelId: "ch-1", log });

    const tool = makeSortTableDispatcher(ctx.emit, ctx);
    await callExecute(tool, { column: "region", direction: "desc" });

    expect(events).toEqual([
      { type: "sort_directive", column: "region", direction: "desc" },
    ]);
    const entry = await log.get("ch-1");
    expect(entry.directives).toEqual([
      { type: "sort_directive", column: "region", direction: "desc" },
    ]);
    expect(entry.last_event_at).toBe("2026-04-29T05:00:00.000Z");
    expect(backend.post).not.toHaveBeenCalled();
  });

  it("filterTable, replaceColumnFilter, clearFilters all append in order", async () => {
    const log = new InProcessPresentationStateLog();
    const { ctx, events, backend } = buildContext({ channelId: "ch-1", log });

    await callExecute(makeFilterTableDispatcher(ctx.emit, ctx), {
      column: "amount",
      operator: "gt",
      value: 100,
    });
    await callExecute(makeReplaceColumnFiltersDispatcher(ctx.emit, ctx), {
      column: "amount",
      filters: [{ operator: "between", value: [10, 50] }],
    });
    await callExecute(makeClearFiltersDispatcher(ctx.emit, ctx), {});

    expect(events.map((e) => e.type)).toEqual([
      "filter_directive",
      "filter_directive",
      "filters_cleared",
    ]);
    const entry = await log.get("ch-1");
    expect(entry.directives).toEqual([
      { type: "filter_directive", column: "amount", filters: [{ operator: "gt", value: 100 }] },
      { type: "filter_directive", column: "amount", filters: [{ operator: "between", value: [10, 50] }] },
      { type: "filters_cleared" },
    ]);
    expect(backend.post).not.toHaveBeenCalled();
  });

  it("skips the log append when channelId is empty (no anonymous bucket)", async () => {
    const log = new InProcessPresentationStateLog();
    const appendSpy = vi.spyOn(log, "append");
    const { ctx, events, backend } = buildContext({ channelId: "", log });

    await callExecute(makeSortTableDispatcher(ctx.emit, ctx), {
      column: "region",
      direction: "asc",
    });

    expect(events).toHaveLength(1);
    expect(appendSpy).not.toHaveBeenCalled();
    expect(backend.post).not.toHaveBeenCalled();
  });

  it("isolates per-channel logs across concurrent contexts", async () => {
    const log = new InProcessPresentationStateLog();
    const a = buildContext({ channelId: "ch-a", log });
    const b = buildContext({ channelId: "ch-b", log });

    await callExecute(makeSortTableDispatcher(a.ctx.emit, a.ctx), {
      column: "x",
      direction: "asc",
    });
    await callExecute(makeClearFiltersDispatcher(b.ctx.emit, b.ctx), {});

    expect((await log.get("ch-a")).directives.map((d) => d.type)).toEqual(["sort_directive"]);
    expect((await log.get("ch-b")).directives.map((d) => d.type)).toEqual(["filters_cleared"]);
  });

  it("emits on SSE even if the log append rejects (best-effort)", async () => {
    const failingLog: InProcessPresentationStateLog = Object.assign(
      Object.create(InProcessPresentationStateLog.prototype),
      {
        append: vi.fn(async () => {
          throw new Error("storage offline");
        }),
        get: vi.fn(async (id: string) => ({ channel_id: id, directives: [], last_event_at: "" })),
      },
    );
    const { ctx, events, backend } = buildContext({
      channelId: "ch-1",
      log: failingLog,
    });

    const tool = makeSortTableDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { column: "region", direction: "desc" });

    expect(result.ok).toBe(true);
    expect(events).toEqual([
      { type: "sort_directive", column: "region", direction: "desc" },
    ]);
    expect(backend.post).not.toHaveBeenCalled();
  });
});
