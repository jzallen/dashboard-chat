import type { Message, TableSchema, ToolCall } from "./types";

// ============================================================================
// Types
// ============================================================================

interface GroqTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  messages: GroqMessage[];
  tools: GroqTool[];
}

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

function getToolDefinitions(tableSchema: TableSchema): GroqTool[] {
  const columnNames = tableSchema.columns.map((c) => c.id);
  const columnDescriptions = tableSchema.columns
    .map((c) => `"${c.id}" (${c.type})`)
    .join(", ");

  return [
    {
      type: "function",
      function: {
        name: "filterTable",
        description: `Filter table rows based on column values. Available columns: ${columnDescriptions}`,
        parameters: {
          type: "object",
          properties: {
            column: {
              type: "string",
              enum: columnNames,
              description: "Column ID to filter",
            },
            operator: {
              type: "string",
              enum: [
                "equals",
                "notEquals",
                "contains",
                "gt",
                "lt",
                "gte",
                "lte",
              ],
              description: "Comparison operator",
            },
            value: {
              type: ["string", "number", "boolean"],
              description: "Value to filter by",
            },
          },
          required: ["column", "operator", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
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
    },
    {
      type: "function",
      function: {
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
    },
    {
      type: "function",
      function: {
        name: "deleteRow",
        description:
          "Delete a row from the table by its index (0-based) or by matching criteria",
        parameters: {
          type: "object",
          properties: {
            rowIndex: {
              type: "number",
              description: "Zero-based index of the row to delete",
            },
          },
          required: ["rowIndex"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clearFilters",
        description: "Remove all active filters from the table",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clearSort",
        description: "Remove sorting from the table",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ];
}

// ============================================================================
// System Prompt
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
1. When the user asks to filter, sort, or modify the table, use the appropriate tool.
2. For filtering:
   - Use "equals" for exact matches
   - Use "contains" for partial string matches
   - Use "gt", "lt", "gte", "lte" for numeric comparisons
3. For sorting, specify the column and direction ("asc" or "desc").
4. For adding rows, provide data matching the column schema.
5. For deleting rows, specify the row index (0-based).
6. Always confirm what action you're taking in your response.
7. If the user's request is ambiguous, ask for clarification.
8. If a request doesn't require a table operation, just respond conversationally.

Be concise in your responses.`;
}

// ============================================================================
// Groq Chat Client Implementation
// ============================================================================

class GroqChatClient implements ChatClient {
  constructor(private apiKey: string) {}

  async *streamCompletion(
    request: ChatCompletionRequest
  ): AsyncGenerator<string> {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: request.messages,
          tools: request.tools,
          tool_choice: "auto",
          stream: true,
          temperature: 0.1, // Low temperature for more deterministic tool calls
          max_tokens: 1024,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;
          yield data;
        }
      }
    }
  }
}

// ============================================================================
// Chat Handler
// ============================================================================

export async function handleChat(
  request: Request,
  client: ChatClient
): Promise<Response> {
  const { messages, tableSchema }: ChatRequest = await request.json();

  const systemPrompt = getSystemPrompt(tableSchema);
  const groqMessages: GroqMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    })),
  ];

  const tools = getToolDefinitions(tableSchema);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const streamPromise = (async () => {
    try {
      let accumulatedToolCalls: Record<
        number,
        { id: string; function: { name: string; arguments: string } }
      > = {};

      for await (const chunk of client.streamCompletion({
        messages: groqMessages,
        tools,
      })) {
        try {
          const parsed = JSON.parse(chunk);
          const delta = parsed.choices?.[0]?.delta;

          if (!delta) continue;

          if (delta.content) {
            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "content",
                  content: delta.content,
                })}\n\n`
              )
            );
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index;
              if (!accumulatedToolCalls[index]) {
                accumulatedToolCalls[index] = {
                  id: tc.id || "",
                  function: { name: "", arguments: "" },
                };
              }
              if (tc.id) accumulatedToolCalls[index].id = tc.id;
              if (tc.function?.name)
                accumulatedToolCalls[index].function.name += tc.function.name;
              if (tc.function?.arguments)
                accumulatedToolCalls[index].function.arguments +=
                  tc.function.arguments;
            }
          }

          if (parsed.choices?.[0]?.finish_reason) {
            const toolCallsArray = Object.values(accumulatedToolCalls);
            if (toolCallsArray.length > 0) {
              await writer.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_calls",
                    tool_calls: toolCallsArray.map((tc) => ({
                      id: tc.id,
                      type: "function",
                      function: tc.function,
                    })),
                  })}\n\n`
                )
              );
            }

            await writer.write(
              encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
            );
          }
        } catch {
          // Skip malformed chunks
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`
        )
      );
    } finally {
      await writer.close();
    }
  })();

  streamPromise.catch(console.error);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ============================================================================
// Factory Function
// ============================================================================

interface Env {
  GROQ_API_KEY: string;
}

export function createChatHandler(env: Env) {
  const client = new GroqChatClient(env.GROQ_API_KEY);
  return (request: Request) => handleChat(request, client);
}
