import type { ChatClient, ChatCompletionRequest } from "../handleChat";

export class GroqChatClient implements ChatClient {
  constructor(private apiKey: string) {}

  async *streamCompletion(
    request: ChatCompletionRequest
  ): AsyncGenerator<string> {
    // Transform Message[] to OpenAI format (content must be string | null)
    const apiMessages = request.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    }));

    // Transform ToolDefinition[] to OpenAI format
    const apiTools = request.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

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
          messages: apiMessages,
          tools: apiTools,
          tool_choice: "auto",
          stream: true,
          temperature: 0.1,
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
