import { useState, useRef, useEffect, useCallback } from "react";
import type { ToolCall } from "../../table-tools";
import type { Message, TableSchema, SSEMessage } from "../types";
import { API_URL } from "../data/sampleData";

interface UseChatOptions {
  executeToolCall: (toolCall: ToolCall) => string;
  tableSchema: TableSchema;
}

export function useChat({ executeToolCall, tableSchema }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null!);
  const inputRef = useRef<HTMLInputElement>(null!);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;

      const userMessage: Message = {
        id: String(Date.now()),
        role: "user",
        content: input.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      // Create assistant message placeholder
      const assistantId = String(Date.now() + 1);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
        },
      ]);

      try {
        // Build message history for API
        const apiMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
        }));

        const response = await fetch(`${API_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            tableSchema,
          }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error("No response body");

        // Process SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulatedContent = "";
        let toolCalls: ToolCall[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const data: SSEMessage = JSON.parse(jsonStr);

              switch (data.type) {
                case "content":
                  if (data.content) {
                    accumulatedContent += data.content;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, content: accumulatedContent }
                          : m
                      )
                    );
                  }
                  break;

                case "tool_calls":
                  if (data.tool_calls) {
                    toolCalls = data.tool_calls;
                  }
                  break;

                case "error":
                  throw new Error(data.error || "Stream error");

                case "done":
                  // Execute tool calls
                  if (toolCalls.length > 0) {
                    const results = toolCalls.map((tc) => executeToolCall(tc));
                    const toolSummary = results.join(", ");

                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? {
                              ...m,
                              content:
                                accumulatedContent || `Executed: ${toolSummary}`,
                              tool_calls: toolCalls,
                              isStreaming: false,
                            }
                          : m
                      )
                    );
                  } else {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, isStreaming: false } : m
                      )
                    );
                  }
                  break;
              }
            } catch (parseError) {
              console.error("Parse error:", parseError);
            }
          }
        }
      } catch (error) {
        console.error("Chat error:", error);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Error: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`,
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [input, isLoading, messages, tableSchema, executeToolCall]
  );

  return {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
    inputRef,
    chatEndRef,
  };
}
