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

import { backendClient } from "../../../lib/chat/backend-client";
import { ChatEventSchema } from "../../../lib/chat/events";

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

describe.skip("PR 1 — cleaning tools dispatch via worker", () => {
  it("applyCleaningTransform dispatch emits transform_applied", async () => {
    // Given a chat turn that triggers applyCleaningTransform with column "region", operation "trim"
    // When the worker dispatches the tool call (Groq replayed from fixture)
    // Then the SSE stream emits a transform_applied event with column "region", operation "trim"
    // And the event's transform_id matches what backend returned
    // And the tool's execute callback returns { ok: true, transform_id }
    expect.fail("PR 1 polecat implements.");
  });

  it("applyCleaningTransform emits error_occurred on backend failure", async () => {
    // Given a chat turn that triggers applyCleaningTransform
    // And the backend is configured to return 500 for the next call
    // When the worker dispatches the tool call
    // Then the SSE stream emits an error_occurred event with phase "backend_dispatch"
    // And the error_occurred event has failed_tool "applyCleaningTransform"
    // And the tool's execute callback returns { ok: false, error: <message> }
    // And the SSE stream is NOT terminated (Q7 — continue past errors)
    expect.fail("PR 1 polecat implements.");
  });

  it("Multiple cleaning tools in one turn — partial-progress emits per call", async () => {
    // Given a chat turn that triggers three applyCleaningTransform calls
    // And the backend is configured to fail on the second call only
    // When the worker dispatches all three (Groq replayed from fixture)
    // Then the SSE stream contains exactly two transform_applied events
    // And the SSE stream contains exactly one error_occurred event with failed_tool "applyCleaningTransform"
    // And the events appear in the order: success, error, success
    // And the tool execute results in the message thread reflect 2x ok:true and 1x ok:false
    expect.fail("PR 1 polecat implements.");
  });
});

// ---- PR 2: Row + column mutations ----------------------------------------

describe.skip("PR 2 — row and column mutations dispatch via worker", () => {
  it("addRow emits row_added with backend-issued id", async () => {
    expect.fail("PR 2 polecat implements.");
  });

  it("deleteRow emits row_deleted", async () => {
    expect.fail("PR 2 polecat implements.");
  });

  it("renameColumn emits column_renamed with old + new names", async () => {
    expect.fail("PR 2 polecat implements.");
  });

  it("undoCleaningTransform with disable mode emits transform_undone mode=disable", async () => {
    expect.fail("PR 2 polecat implements.");
  });

  it("undoCleaningTransform with delete mode emits transform_undone mode=delete", async () => {
    expect.fail("PR 2 polecat implements.");
  });

  it("reEnableCleaningTransform emits transform_re_enabled", async () => {
    expect.fail("PR 2 polecat implements.");
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
