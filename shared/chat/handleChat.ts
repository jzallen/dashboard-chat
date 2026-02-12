import type { Message, TableSchema, ToolDefinition } from "./types";
import { getToolDefinitions, getSystemPrompt } from "./prompts";

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
