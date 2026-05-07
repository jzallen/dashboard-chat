import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";
import { mockStreamTextResult, parseSseFrames } from "./_v6Mocks";

/**
 * Integration test for report-context chat requests.
 *
 * Exercises handleChat end-to-end with a mocked LLM:
 *   1. The mock inspects the tool set passed to streamText and emits a v6
 *      tool-input-available chunk whose toolName belongs to that set.
 *   2. We POST a chat request with contextType: "report".
 *   3. We assert streamText received the report tool set (the deterministic
 *      driving-port-level signal of routing). Raw `tool-*` chunks are
 *      intentionally dropped by pipeChatStream so they do not appear on the
 *      SSE wire — production code translates tool calls into typed
 *      `data-chat-event` parts via dispatchers.
 */

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn((opts: { tools?: Record<string, unknown> }) => {
      const toolNames = Object.keys(opts.tools ?? {});
      let emittedToolName: string;
      if (toolNames.includes("createReport")) {
        emittedToolName = "createReport";
      } else if (toolNames.includes("sortTable")) {
        emittedToolName = "sortTable";
      } else if (toolNames.includes("createView")) {
        emittedToolName = "createView";
      } else {
        emittedToolName = "unknown";
      }
      const chunks: UIMessageChunk[] = [
        {
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: emittedToolName,
          input: {},
        } as UIMessageChunk,
        { type: "finish", finishReason: "tool-calls" } as UIMessageChunk,
      ];
      return mockStreamTextResult(chunks);
    }),
    tool: vi.fn((opts: unknown) => opts),
  };
});

vi.mock("@ai-sdk/groq", () => ({
  createGroq: () => () => "mock-model",
}));

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const env = { GROQ_API_KEY: "test-key" };

describe("handleChat — report context integration", () => {
  it("routes report context through the report tool set (createReport, not sortTable/createView/addColumn)", async () => {
    const { streamText } = await import("ai");
    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "create a fact report for revenue" }],
        contextType: "report",
        contextId: "r-1",
        tableSchema: {
          columns: [{ id: "month", type: "string" }],
          rowCount: 0,
          layerContext: {
            layer: "report",
            modelName: "monthly_revenue",
            sqlDefinition: "SELECT month, SUM(amount) FROM orders GROUP BY month",
            sourceSchemas: ["int_orders"],
          },
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    // v6 SSE pipeline emits text/event-stream (createUIMessageStreamResponse).
    expect(response.headers.get("Content-Type")).toMatch(/text\/event-stream/i);

    // Driving-port assertion: streamText was given the report tool set.
    const callArgs = (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(callArgs.tools).toHaveProperty("createReport");
    expect(callArgs.tools).not.toHaveProperty("sortTable");
    expect(callArgs.tools).not.toHaveProperty("createView");
    expect(callArgs.tools).not.toHaveProperty("addColumn");

    // Wire-format assertion: NO raw tool-* chunks surface on the SSE stream.
    // (pipeChatStream drops them — dispatchers translate them into typed parts.)
    const frames = await parseSseFrames(response);
    const rawToolFrames = frames.filter(
      (f) => typeof f.type === "string" && f.type.startsWith("tool-"),
    );
    expect(rawToolFrames).toHaveLength(0);
  });

  it("dataset context routes through the dataset tool set (sortTable, not createReport)", async () => {
    const { streamText } = await import("ai");
    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "sort the table" }],
        contextType: "dataset",
        contextId: "ds-1",
        tableSchema: {
          columns: [{ id: "name", type: "string" }],
          rowCount: 10,
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const callArgs = (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(callArgs.tools).toHaveProperty("sortTable");
    expect(callArgs.tools).not.toHaveProperty("createReport");
  });

  it("view context routes through the view tool set (createView, not createReport)", async () => {
    const { streamText } = await import("ai");
    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "create a view" }],
        contextType: "view",
        contextId: "v-1",
      }),
      env,
    );

    expect(response.status).toBe(200);
    const callArgs = (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(callArgs.tools).toHaveProperty("createView");
    expect(callArgs.tools).not.toHaveProperty("createReport");
  });
});
