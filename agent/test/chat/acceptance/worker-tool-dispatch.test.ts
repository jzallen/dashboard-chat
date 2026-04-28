/**
 * Worker tool-dispatch acceptance suite — see worker-tool-dispatch.feature.
 *
 * Story 1 / AC1.1, AC1.2, AC1.3, AC1.4
 * Story 4 / AC4.1, AC4.2 (worker-observable shape)
 *
 * Skipped until each PR lands. Polecat un-skips the matching `describe.skip`
 * block during DELIVER as scenarios become testable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BackendClient,
  backendClient,
  BackendClientError,
} from "../../../lib/chat/backend-client";
import type { DispatchContext } from "../../../lib/chat/dispatchers";
import {
  makeApplyCleaningTransformDispatcher,
} from "../../../lib/chat/dispatchers/cleaning";
import {
  makeAddRowDispatcher,
  makeDeleteRowDispatcher,
  makeReEnableCleaningTransformDispatcher,
  makeRenameColumnDispatcher,
  makeUndoCleaningTransformDispatcher,
} from "../../../lib/chat/dispatchers/mutations";
import { type ChatEvent, ChatEventSchema } from "../../../lib/chat/events";

type ToolWithExecute = {
  execute: (
    input: Record<string, unknown>,
    options: { toolCallId: string; messages: unknown[] },
  ) => Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
};

function buildContext(overrides: {
  backend: BackendClient;
  emit: (event: ChatEvent) => void;
  datasetId?: string;
}): DispatchContext {
  return {
    jwt: "test.jwt.value",
    datasetId: overrides.datasetId ?? "ds-1",
    projectId: undefined,
    contextType: "dataset",
    backend: overrides.backend,
    emit: overrides.emit,
  };
}

function callExecute(
  tool: unknown,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> & { ok: boolean; error?: string }> {
  const t = tool as ToolWithExecute;
  return t.execute(input, { toolCallId: "tc-test", messages: [] });
}

// ---- PR 0: Scaffolding contract ------------------------------------------

describe("PR 0 — scaffolding contract", () => {
  it("ChatEventSchema parses every event the worker may emit", () => {
    // Given the agent's events.ts module exports ChatEventSchema
    // When a sample of every event variant in the closed vocabulary is parsed
    // Then every parse returns a valid ChatEvent / no parse throws
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
    for (const sample of samples) {
      expect(() => ChatEventSchema.parse(sample)).not.toThrow();
    }
  });

  describe("Worker forwards JWT via auth-proxy when calling backend", () => {
    let originalFetch: typeof fetch;
    let capturedRequest: Request | null;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      capturedRequest = null;
      globalThis.fetch = vi.fn(async (input, init) => {
        const req = input instanceof Request ? input : new Request(input as string | URL, init);
        capturedRequest = req;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("forwards Authorization: Bearer <JWT> verbatim", async () => {
      // Given a DispatchContext with a known JWT
      const client = backendClient({ authProxyUrl: "http://localhost:8788", jwt: "test.jwt.value" });
      // When the worker's backend-client issues POST /api/datasets/{id}/transforms
      const result = await client.post("/api/datasets/d-1/transforms", { transforms: [] });
      // Then the request URL targets the auth-proxy
      expect(capturedRequest!.url).toBe("http://localhost:8788/api/datasets/d-1/transforms");
      // And auth-proxy receives Authorization: Bearer <JWT>
      expect(capturedRequest!.headers.get("authorization")).toBe("Bearer test.jwt.value");
      expect(capturedRequest!.method).toBe("POST");
      // And the response body parses to a truthy value
      expect(result).toEqual({ ok: true });
    });
  });
});

// ---- PR 1: Cleaning tools ------------------------------------------------

describe("PR 1 — cleaning tools dispatch via worker", () => {
  it("applyCleaningTransform dispatch emits transform_applied", async () => {
    // Given a DispatchContext bound to dataset ds-1 and a fake backend that
    // returns the persisted transform id "t-abc"
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ id: "t-abc" })),
      get: vi.fn(),
    };
    const ctx = buildContext({
      backend,
      emit: (e) => events.push(e),
      datasetId: "ds-1",
    });

    // When the dispatcher's execute callback runs for column=region, operation=trim
    const tool = makeApplyCleaningTransformDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, {
      column: "region",
      operation: "trim",
      config: {},
    });

    // Then exactly one transform_applied event was emitted with the matching id
    const applied = events.filter((e) => e.type === "transform_applied");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      type: "transform_applied",
      transform_id: "t-abc",
      dataset_id: "ds-1",
      operation: "trim",
      column: "region",
    });
    // And the emitted event parses cleanly through ChatEventSchema (contract)
    expect(() => ChatEventSchema.parse(applied[0])).not.toThrow();
    // And the execute callback returns the structured success
    expect(result).toEqual({ ok: true, transform_id: "t-abc" });
    // And the backend was called with the canonical transforms-batch shape
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/transforms",
      expect.objectContaining({
        transforms: expect.arrayContaining([
          expect.objectContaining({
            target_column: "region",
            transform_type: "clean",
            expression_config: { operation: "trim" },
          }),
        ]),
      }),
    );
  });

  it("applyCleaningTransform emits error_occurred on backend failure", async () => {
    // Given a backend that fails the next call with HTTP 500
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => {
        throw new BackendClientError(500, "boom", "POST failed: 500");
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({
      backend,
      emit: (e) => events.push(e),
      datasetId: "ds-1",
    });

    // When the dispatcher's execute runs
    const tool = makeApplyCleaningTransformDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, {
      column: "region",
      operation: "trim",
      config: {},
    });

    // Then exactly one error_occurred event was emitted with phase backend_dispatch
    const errors = events.filter((e) => e.type === "error_occurred");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "error_occurred",
      phase: "backend_dispatch",
      failed_tool: "applyCleaningTransform",
      retryable: true,
    });
    // And no transform_applied was emitted
    expect(events.some((e) => e.type === "transform_applied")).toBe(false);
    // And the execute callback returns { ok: false, error } — never throws past execute
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("Multiple cleaning tools in one turn — partial-progress emits per call", async () => {
    // Given a backend where the second call (only) fails — Q7: continue past errors
    const events: ChatEvent[] = [];
    let callIndex = 0;
    const backend: BackendClient = {
      post: vi.fn(async () => {
        callIndex += 1;
        if (callIndex === 2) {
          throw new BackendClientError(500, "second fails", "POST failed: 500");
        }
        return { id: `t-${callIndex}` };
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({
      backend,
      emit: (e) => events.push(e),
      datasetId: "ds-1",
    });

    // When three apply calls are dispatched in order
    const tool = makeApplyCleaningTransformDispatcher(ctx.emit, ctx);
    const r1 = await callExecute(tool, { column: "a", operation: "trim", config: {} });
    const r2 = await callExecute(tool, { column: "b", operation: "trim", config: {} });
    const r3 = await callExecute(tool, { column: "c", operation: "trim", config: {} });

    // Then we see two transform_applied events and one error_occurred event...
    const applied = events.filter((e) => e.type === "transform_applied");
    const errors = events.filter((e) => e.type === "error_occurred");
    expect(applied).toHaveLength(2);
    expect(errors).toHaveLength(1);
    // ...in the order success, error, success
    expect(events.map((e) => e.type)).toEqual([
      "transform_applied",
      "error_occurred",
      "transform_applied",
    ]);
    // And the tool execute results reflect 2x ok:true and 1x ok:false
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(true);
  });
});

// ---- PR 2: Row + column mutations ----------------------------------------

describe("PR 2 — row and column mutations dispatch via worker", () => {
  it("addRow emits row_added with backend-issued id", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ id: "row-42" })),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeAddRowDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { data: { name: "Alpha" } });

    const added = events.filter((e) => e.type === "row_added");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      type: "row_added",
      dataset_id: "ds-1",
      row_id: "row-42",
    });
    expect(() => ChatEventSchema.parse(added[0])).not.toThrow();
    expect(result).toEqual({ ok: true, row_id: "row-42" });
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/rows",
      { row: { name: "Alpha" } },
    );
  });

  it("deleteRow emits row_deleted", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ ok: true })),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeDeleteRowDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { row_id: "row-7" });

    const deleted = events.filter((e) => e.type === "row_deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      type: "row_deleted",
      dataset_id: "ds-1",
      row_id: "row-7",
    });
    expect(result).toEqual({ ok: true, row_id: "row-7" });
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/rows/row-7/delete",
      {},
    );
  });

  it("renameColumn emits column_renamed with old + new names", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ ok: true })),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeRenameColumnDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, {
      column: "first_name",
      newName: "Given Name",
    });

    const renamed = events.filter((e) => e.type === "column_renamed");
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({
      type: "column_renamed",
      dataset_id: "ds-1",
      old_name: "first_name",
      new_name: "Given Name",
    });
    expect(result).toEqual({
      ok: true,
      old_name: "first_name",
      new_name: "Given Name",
    });
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/transforms",
      expect.objectContaining({
        transforms: expect.arrayContaining([
          expect.objectContaining({
            transform_type: "alias",
            target_column: "first_name",
            expression_config: { operation: "alias", alias: "Given Name" },
          }),
        ]),
      }),
    );
  });

  it("undoCleaningTransform with disable mode emits transform_undone mode=disable", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ ok: true })),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeUndoCleaningTransformDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, {
      transform_id: "t-9",
      mode: "disable",
    });

    const undone = events.filter((e) => e.type === "transform_undone");
    expect(undone).toHaveLength(1);
    expect(undone[0]).toMatchObject({
      type: "transform_undone",
      transform_id: "t-9",
      dataset_id: "ds-1",
      mode: "disable",
    });
    expect(result).toEqual({ ok: true, transform_id: "t-9", mode: "disable" });
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/transforms/patch",
      { updates: [{ id: "t-9", status: "disabled" }] },
    );
  });

  it("undoCleaningTransform with delete mode emits transform_undone mode=delete", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ ok: true })),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeUndoCleaningTransformDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, {
      transform_id: "t-9",
      mode: "delete",
    });

    const undone = events.filter((e) => e.type === "transform_undone");
    expect(undone).toHaveLength(1);
    expect(undone[0]).toMatchObject({
      type: "transform_undone",
      mode: "delete",
    });
    expect(result).toEqual({ ok: true, transform_id: "t-9", mode: "delete" });
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/transforms/patch",
      { updates: [{ id: "t-9", status: "deleted" }] },
    );
  });

  it("reEnableCleaningTransform emits transform_re_enabled", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => ({ ok: true })),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeReEnableCleaningTransformDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { transform_id: "t-3" });

    const reenabled = events.filter((e) => e.type === "transform_re_enabled");
    expect(reenabled).toHaveLength(1);
    expect(reenabled[0]).toMatchObject({
      type: "transform_re_enabled",
      transform_id: "t-3",
      dataset_id: "ds-1",
    });
    expect(result).toEqual({ ok: true, transform_id: "t-3" });
    expect(backend.post).toHaveBeenCalledWith(
      "/api/datasets/ds-1/transforms/patch",
      { updates: [{ id: "t-3", status: "enabled" }] },
    );
  });

  it("addRow emits error_occurred when the backend fails (Q7 — never throws past execute)", async () => {
    const events: ChatEvent[] = [];
    const backend: BackendClient = {
      post: vi.fn(async () => {
        throw new BackendClientError(500, "boom", "POST failed: 500");
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: (e) => events.push(e) });

    const tool = makeAddRowDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { data: { name: "Alpha" } });

    const errors = events.filter((e) => e.type === "error_occurred");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "error_occurred",
      phase: "backend_dispatch",
      failed_tool: "addRow",
      retryable: true,
    });
    expect(events.some((e) => e.type === "row_added")).toBe(false);
    expect(result.ok).toBe(false);
  });
});

// ---- PR 3: UI directives -------------------------------------------------

describe.skip("PR 3 — UI directives dispatch via worker (no backend call)", () => {
  it("sortTable emits sort_directive without calling backend", async () => {
    expect.fail("PR 3 polecat implements.");
  });

  it("filterTable emits filter_directive", async () => {
    expect.fail("PR 3 polecat implements.");
  });

  it("clearFilters emits filters_cleared", async () => {
    expect.fail("PR 3 polecat implements.");
  });
});

// ---- Structural: backend stays chat-unaware (AC1.4 / K2) -----------------

describe.skip("structural — backend stays chat-unaware", () => {
  it("Backend production code references no chat / Groq / SSE concepts", async () => {
    // Given the repository is at the post-PR-3 state
    // When `rg -i 'groq|sse|tool_call|tool_calls' backend/app/` runs
    // Then the command exits with non-zero (zero matches)
    // And the same command run against agent/lib/chat/ DOES return matches
    expect.fail("PR 3 polecat enables and runs the rg via execSync; this guards K2.");
  });
});
