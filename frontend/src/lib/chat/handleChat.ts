import type { Message, TableSchema, ToolDefinition } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface ChatCompletionRequest {
  messages: Message[];
  tools: ToolDefinition[];
}

type AccumulatedToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

export interface ChatClient {
  streamCompletion(request: ChatCompletionRequest): AsyncGenerator<string>;
}

interface ChatRequest {
  messages: Message[];
  tableSchema: TableSchema;
}

// ============================================================================
// Tool Definitions
// ============================================================================

function getToolDefinitions(tableSchema: TableSchema): ToolDefinition[] {
  const columnNames = tableSchema.columns.map((c) => c.id);
  const columnDescriptions = tableSchema.columns
    .map((c) => `"${c.id}" (${c.type})`)
    .join(", ");

  return [
    {
      name: "sortTable",
      description: `Sort table by a column. Available columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: columnNames,
            description: "Column ID to sort by",
          },
          direction: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction: ascending or descending",
          },
        },
        required: ["column", "direction"],
      },
    },
    {
      name: "addRow",
      description: `Add a new row to the table. Columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          data: {
            type: "object",
            description:
              "Key-value pairs for the new row. Keys should match column IDs.",
            additionalProperties: true,
          },
        },
        required: ["data"],
      },
    },
    {
      name: "deleteRow",
      description:
        "Delete a row from the table by searching for matching text across all columns.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description:
              "Text to search for. Matches against any column value in the row.",
          },
        },
        required: ["search"],
      },
    },
    {
      name: "clearFilters",
      description: "Remove all active filters from the table",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "clearSort",
      description: "Remove sorting from the table",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "filterTable",
      description: `Filter the table by a single column. Use this for simple, single-condition filters. Available columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: columnNames,
            description: "Column ID to filter by",
          },
          operator: {
            type: "string",
            enum: [
              "equals",
              "notEquals",
              "contains",
              "startsWith",
              "endsWith",
              "gt",
              "gte",
              "lt",
              "lte",
              "between",
            ],
            description:
              "Comparison operator. Use gt/gte/lt/lte for numbers, contains/startsWith/endsWith for text.",
          },
          value: {
            description:
              "Value to compare against. Use number for numeric comparisons, string for text. For 'between', use an array of two numbers.",
          },
        },
        required: ["column", "operator", "value"],
      },
    },
  ];
}

// ============================================================================
// System Prompt
// TODO: Improve natural language understanding for less direct prompts.
//   - Include sample column values in schema context so the LLM can infer
//     intent (e.g. "change east to west" → filter region=east).
//   - Consider lowering temperature for more deterministic tool selection.
//   - Add an "updateCell" tool for in-place data edits.
//   - Instruct the LLM to always reply with text when no tool applies.
// ============================================================================

function getSystemPrompt(tableSchema: TableSchema): string {
  const columnDescriptions = tableSchema.columns
    .map((c) => `  - "${c.id}" (${c.type})`)
    .join("\n");

  return `You are a helpful assistant that controls a data table. You can filter, sort, add rows, and delete rows using the provided tools.

CURRENT TABLE SCHEMA:
${columnDescriptions}

Total rows: ${tableSchema.rowCount}

INSTRUCTIONS:
1. For filtering, use "filterTable":
   - Example: "show items over $50" → filterTable(column="amount", operator="gt", value=50)
   - Operators: equals, notEquals, contains, startsWith, endsWith, gt, gte, lt, lte, between
   - For multiple filters, call filterTable multiple times

2. For sorting, use "sortTable" with column and direction ("asc" or "desc").
3. For adding rows, use "addRow" with data matching the column schema.
4. For deleting rows, use "deleteRow" with search text that matches the row.
5. Use "clearFilters" or "clearSort" to reset the table view.

Be concise. Confirm what action you're taking.`;
}

// ============================================================================
// SSE Stream Writer
// ============================================================================

class SSEStreamWriter {
  private writer: WritableStreamDefaultWriter;
  private encoder = new TextEncoder();
  private accumulatedToolCalls: Record<number, AccumulatedToolCall> = {};
  readonly readable: ReadableStream;

  constructor() {
    const { readable, writable } = new TransformStream();
    this.readable = readable;
    this.writer = writable.getWriter();
  }

  private async write(payload: object): Promise<void> {
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    await this.writer.write(this.encoder.encode(message));
  }

  async writeContent(content: string | undefined): Promise<void> {
    if (!content) return;
    await this.write({ type: "content", content });
  }

  accumulateToolCalls(
    toolCalls:
      | Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>
      | undefined
  ): void {
    if (!toolCalls) return;

    for (const tc of toolCalls) {
      const index = tc.index;
      if (!this.accumulatedToolCalls[index]) {
        this.accumulatedToolCalls[index] = {
          id: tc.id || "",
          function: { name: "", arguments: "" },
        };
      }
      if (tc.id) this.accumulatedToolCalls[index].id = tc.id;
      if (tc.function?.name)
        this.accumulatedToolCalls[index].function.name += tc.function.name;
      if (tc.function?.arguments)
        this.accumulatedToolCalls[index].function.arguments +=
          tc.function.arguments;
    }
  }

  async writeToolCalls(): Promise<void> {
    const toolCallsArray = Object.values(this.accumulatedToolCalls);
    if (toolCallsArray.length === 0) return;

    await this.write({
      type: "tool_calls",
      tool_calls: toolCallsArray.map((tc) => ({
        id: tc.id,
        type: "function",
        function: tc.function,
      })),
    });
  }

  async writeDone(): Promise<void> {
    await this.write({ type: "done" });
  }

  async writeError(error: unknown): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await this.write({ type: "error", error: errorMessage });
  }

  async close(): Promise<void> {
    await this.writer.close();
  }
}

// ============================================================================
// Chat Handler
// ============================================================================

interface HandleChatOptions {
  corsOrigin: string;
}

export async function handleChat(
  request: Request,
  client: ChatClient,
  options: HandleChatOptions
): Promise<Response> {
  const { messages, tableSchema }: ChatRequest = await request.json();

  const systemPrompt = getSystemPrompt(tableSchema);
  const chatMessages: Message[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const tools = getToolDefinitions(tableSchema);
  const stream = new SSEStreamWriter();

  // Stream LLM response; transform persistence is handled by the frontend
  streamLLMResponse(
    client,
    { messages: chatMessages, tools },
    stream
  ).catch(console.error);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": options.corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

async function streamLLMResponse(
  client: ChatClient,
  request: ChatCompletionRequest,
  stream: SSEStreamWriter
): Promise<void> {
  let streamCompleted = false;

  try {
    for await (const chunk of client.streamCompletion(request)) {
      try {
        const parsed = JSON.parse(chunk);
        const delta = parsed.choices?.[0]?.delta;
        const finishReason = parsed.choices?.[0]?.finish_reason;

        if (!delta && !finishReason) continue;

        if (delta) {
          await stream.writeContent(delta.content);
          stream.accumulateToolCalls(delta.tool_calls);
        }

        if (finishReason) {
          await stream.writeToolCalls();
          await stream.writeDone();
          streamCompleted = true;
        }
      } catch (parseError) {
        console.error("[handleChat] Parse error for chunk:", parseError);
      }
    }

    // Ensure done is sent even if no finishReason was received
    if (!streamCompleted) {
      await stream.writeToolCalls();
      await stream.writeDone();
    }
  } catch (error) {
    await stream.writeError(error);
  } finally {
    await stream.close();
  }
}
