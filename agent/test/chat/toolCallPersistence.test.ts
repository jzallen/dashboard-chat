/**
 * Tool-call persistence hook (rich-catalog §2.7 Option A).
 *
 * After a transform tool executes successfully the agent POSTs a tool-call as an
 * audit entry FIRST (to /api/projects/{projectId}/audit), gets back its id, then
 * includes that id as `assistant_audit_entry_id` on the transform create/patch so
 * the Transform points UP at the entry (the reversed FK). A failed tool-call POST
 * must NOT abort the user's transform (provenance is best-effort).
 */

import { describe, expect, it, vi } from "vitest";

import {
  type BackendClient,
  BackendClientError,
} from "../../lib/chat/backend-client";
import type { DispatchContext } from "../../lib/chat/dispatchers";
import {
  makeFillNullsDispatcher,
  makeMapValuesDispatcher,
  makeTrimWhitespaceDispatcher,
} from "../../lib/chat/dispatchers/cleaning";
import type { ChatEvent } from "../../lib/chat/events";
import { noopPresentationStateLog } from "../../lib/chat/presentationState";
import { auditTagForOperation } from "../../lib/chat/toolCallTags";

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
  const t = tool as ToolWithExecute;
  return t.execute(input, { toolCallId: "tc-test", messages: [] });
}

function buildContext(overrides: {
  backend: BackendClient;
  emit: (event: ChatEvent) => void;
  datasetId?: string;
  projectId?: string;
}): DispatchContext {
  return {
    jwt: "test.jwt.value",
    datasetId: overrides.datasetId ?? "ds-1",
    projectId: "projectId" in overrides ? overrides.projectId : "proj-1",
    contextType: "dataset",
    backend: overrides.backend,
    emit: overrides.emit,
    channelId: "",
    presentationState: noopPresentationStateLog,
  };
}

describe("tool→tag map", () => {
  it("resolves cleaning operations to their audit tags", () => {
    expect(auditTagForOperation("trim")).toBe("clean");
    expect(auditTagForOperation("upper")).toBe("clean");
    expect(auditTagForOperation("title")).toBe("clean");
    expect(auditTagForOperation("fill_null")).toBe("fix");
    expect(auditTagForOperation("map_values")).toBe("cast");
    expect(auditTagForOperation("filter")).toBe("filter");
  });
});

describe("persist-on-execute (Option A)", () => {
  it("POSTs the audit entry FIRST then the transform with the returned assistant_audit_entry_id", async () => {
    const events: ChatEvent[] = [];
    const calls: Array<{ path: string; body: unknown }> = [];
    const backend: BackendClient = {
      post: vi.fn(async (path: string, body: unknown) => {
        calls.push({ path, body });
        if (path === "/api/projects/proj-1/audit") {
          return { data: { id: "tcr-99", type: "audit-entries" } };
        }
        return { id: "t-abc" };
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({
      backend,
      emit: (e) => events.push(e),
      datasetId: "ds-1",
      projectId: "proj-1",
    });

    const tool = makeTrimWhitespaceDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { column: "email" });

    expect(result.ok).toBe(true);

    // Ordering: audit-entry POST happens before the transform POST.
    expect(calls.map((c) => c.path)).toEqual([
      "/api/projects/proj-1/audit",
      "/api/datasets/ds-1/transforms",
    ]);

    // The audit-entry POST carries node scope + payload {tool, say, tag}.
    expect(calls[0].body).toMatchObject({
      node_id: "ds-1",
      node_kind: "dataset",
      payload: { tool: "trimWhitespace", tag: "clean" },
    });
    expect(
      typeof (calls[0].body as { payload: { say: string } }).payload.say,
    ).toBe("string");

    // The transform create includes the returned assistant_audit_entry_id (reversed FK).
    expect(calls[1].body).toMatchObject({
      transforms: [
        expect.objectContaining({ assistant_audit_entry_id: "tcr-99" }),
      ],
    });
  });

  it("map_values resolves the cast tag in the persisted payload", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const backend: BackendClient = {
      post: vi.fn(async (path: string, body: unknown) => {
        calls.push({ path, body });
        if (path === "/api/projects/proj-1/audit") {
          return { data: { id: "tcr-1" } };
        }
        return { id: "t-1" };
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({ backend, emit: () => {}, projectId: "proj-1" });

    const tool = makeMapValuesDispatcher(ctx.emit, ctx);
    await callExecute(tool, {
      column: "state",
      mappings: [{ from: "CA", to: "California" }],
    });

    const toolCallPost = calls.find(
      (c) => c.path === "/api/projects/proj-1/audit",
    );
    expect(toolCallPost?.body).toMatchObject({
      payload: { tool: "mapValues", tag: "cast" },
    });
  });

  it("a failed tool-call POST does NOT abort the transform", async () => {
    const events: ChatEvent[] = [];
    const calls: string[] = [];
    const backend: BackendClient = {
      post: vi.fn(async (path: string) => {
        calls.push(path);
        if (path === "/api/projects/proj-1/audit") {
          throw new BackendClientError(500, "boom", "POST failed: 500");
        }
        return { id: "t-abc" };
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({
      backend,
      emit: (e) => events.push(e),
      datasetId: "ds-1",
      projectId: "proj-1",
    });

    const tool = makeFillNullsDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { column: "email", fillValue: "n/a" });

    // The transform still ran and succeeded.
    expect(result.ok).toBe(true);
    expect(calls).toContain("/api/datasets/ds-1/transforms");
    // The transform_applied event was still emitted.
    expect(events.some((e) => e.type === "transform_applied")).toBe(true);
    // The provenance failure was NOT surfaced as a user-facing error_occurred.
    expect(events.some((e) => e.type === "error_occurred")).toBe(false);
  });

  it("skips the tool-call POST when no projectId is in scope (still runs the transform)", async () => {
    const calls: string[] = [];
    const backend: BackendClient = {
      post: vi.fn(async (path: string) => {
        calls.push(path);
        return { id: "t-abc" };
      }),
      get: vi.fn(),
    };
    const ctx = buildContext({
      backend,
      emit: () => {},
      datasetId: "ds-1",
      projectId: undefined,
    });

    const tool = makeTrimWhitespaceDispatcher(ctx.emit, ctx);
    const result = await callExecute(tool, { column: "email" });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["/api/datasets/ds-1/transforms"]);
  });
});
