import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import type { ToolCall } from "@/table-tools";
import type { Message, TableSchema, SSEMessage } from "../types";
import { CHAT_URL } from "../data/sampleData";

export interface ToolHandler {
  executeToolCall: (toolCall: ToolCall) => string;
}

interface ChatContextValue {
  messages: Message[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  handleSubmit: (e: FormEvent) => void;
  inputRef: RefObject<HTMLInputElement>;
  chatEndRef: RefObject<HTMLDivElement>;
  registerToolHandler: (handler: ToolHandler | null) => void;
  registerTableSchema: (schema: TableSchema | null) => void;
  isActive: boolean;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null!);
  const inputRef = useRef<HTMLInputElement>(null!);
  const toolHandlerRef = useRef<ToolHandler | null>(null);
  const tableSchemaRef = useRef<TableSchema | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const registerToolHandler = useCallback((handler: ToolHandler | null) => {
    toolHandlerRef.current = handler;
    setIsActive(handler !== null);
  }, []);

  const registerTableSchema = useCallback((schema: TableSchema | null) => {
    tableSchemaRef.current = schema;
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading || !toolHandlerRef.current) return;

      const userMessage: Message = {
        id: String(Date.now()),
        role: "user",
        content: input.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      const assistantId = String(Date.now() + 1);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);

      try {
        const apiMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
        }));

        const response = await fetch(`${CHAT_URL}/chat`, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            tableSchema: tableSchemaRef.current,
          }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error("No response body");

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
                        m.id === assistantId ? { ...m, content: accumulatedContent } : m
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
                  if (toolCalls.length > 0 && toolHandlerRef.current) {
                    const results = toolCalls.map((tc) =>
                      toolHandlerRef.current!.executeToolCall(tc)
                    );
                    const toolSummary = results.join(", ");
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? {
                              ...m,
                              content: accumulatedContent || `Executed: ${toolSummary}`,
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
                  content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
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
    [input, isLoading, messages]
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        input,
        setInput,
        isLoading,
        handleSubmit,
        inputRef,
        chatEndRef,
        registerToolHandler,
        registerTableSchema,
        isActive,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
