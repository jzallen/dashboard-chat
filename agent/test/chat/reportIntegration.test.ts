import { describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";

/**
 * Integration test for report-context chat requests.
 *
 * Exercises handleChat end-to-end with a mocked LLM:
 *   1. The mock inspects the tool set passed to streamText and emits a
 *      tool-call event whose name belongs to that set.
 *   2. We POST a chat request with contextType: "report".
 *   3. We read the data-stream response body and assert it contains a
 *      report-tool call (e.g. createReport) — not a dataset or view tool call.
 */

vi.mock("ai", () => ({
  streamText: vi.fn((opts: { tools?: Record<string, unknown> }) => {
    const toolNames = Object.keys(opts.tools ?? {});
    // Pick a tool that uniquely identifies the context's tool set.
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
    const toolCall = [{ toolCallId: "call-1", toolName: emittedToolName, args: {} }];
    const body =
      `9:${JSON.stringify(toolCall)}\n` +
      `d:${JSON.stringify({ finishReason: "tool-calls" })}\n`;
    return {
      toDataStreamResponse: () =>
        new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "x-vercel-ai-data-stream": "v1",
          },
        }),
    };
  }),
  tool: vi.fn((opts: unknown) => opts),
}));

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
  it("emits report tool calls (not dataset or view tool calls) for contextType 'report'", async () => {
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
    expect(response.headers.get("x-vercel-ai-data-stream")).toBe("v1");

    const bodyText = await response.text();

    // Body contains a report tool call
    expect(bodyText).toContain('"toolName":"createReport"');

    // Body does NOT contain dataset or view tool calls
    expect(bodyText).not.toContain('"toolName":"sortTable"');
    expect(bodyText).not.toContain('"toolName":"createView"');
    expect(bodyText).not.toContain('"toolName":"addColumn"');
  });

  it("dataset context still emits dataset tool calls (baseline for comparison)", async () => {
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
    const bodyText = await response.text();
    expect(bodyText).toContain('"toolName":"sortTable"');
    expect(bodyText).not.toContain('"toolName":"createReport"');
  });

  it("view context still emits view tool calls (baseline for comparison)", async () => {
    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "create a view" }],
        contextType: "view",
        contextId: "v-1",
      }),
      env,
    );

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).toContain('"toolName":"createView"');
    expect(bodyText).not.toContain('"toolName":"createReport"');
  });
});
