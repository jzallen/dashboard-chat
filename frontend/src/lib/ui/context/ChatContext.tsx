import {
  createContext,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Dataset } from "@/api";
import { createSession, logTurn } from "@/api";
import { ensureFreshToken, EXPIRES_AT_KEY, getAuthHeaders, hardLogout } from "@/api/fetchUtils";
import { getSystemPrompt, getToolDefinitions } from "@/chat/prompts";
import type { ToolCall } from "@/table-tools";

import { getErrorMessage } from "../../errors";
import { CHAT_URL } from "../data/config";
import type { Message, SSEMessage,TableSchema } from "../types";

/** Handler registered by DatasetDetail to execute AI tool calls against the table. */
export interface ToolHandler {
  executeToolCall: (toolCall: ToolCall) => string | Promise<string>;
}

/** Values exposed by ChatContext to consumers via useChatContext. */
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
  addMessage: (message: Message) => void;
  onDatasetCreated: (dataset: Dataset) => void;
  registerProjectUpdater: (updater: ((dataset: Dataset) => void) | null) => void;
  registerDatasetId: (datasetId: string | null) => void;
  registerProjectId: (projectId: string | null) => void;
  resetSession: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

async function refreshAuthHeadersIfExpiring(): Promise<Record<string, string>> {
  const headers = getAuthHeaders();
  const expiresAtStr = localStorage.getItem(EXPIRES_AT_KEY);
  if (!expiresAtStr) return headers;

  const expiresAt = Number(expiresAtStr);
  if (expiresAt - Date.now() >= 60_000) return headers;

  try {
    const newToken = await ensureFreshToken();
    if (newToken) return { Authorization: `Bearer ${newToken}` };
  } catch {
    // Proceed with existing token; 401 handler below will catch it
  }
  return headers;
}

async function retryOn401(
  response: Response,
  fetchChat: (headers: Record<string, string>) => Promise<Response>,
): Promise<Response> {
  if (response.status !== 401) return response;

  try {
    const newToken = await ensureFreshToken();
    if (newToken) {
      const retried = await fetchChat({ Authorization: `Bearer ${newToken}` });
      if (retried.status !== 401) return retried;
    }
  } catch {
    // Refresh failed — fall through to logout
  }

  hardLogout();
  // Return original response; hardLogout navigates away
  return response;
}

/** Consumes the ChatContext. Must be used within a ChatProvider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}

/**
 * Provides SSE-based chat streaming, tool call execution, and session management.
 * Manages message state, auth token refresh for streams, and audit logging.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null!);
  const inputRef = useRef<HTMLInputElement>(null!);
  const toolHandlerRef = useRef<ToolHandler | null>(null);
  const tableSchemaRef = useRef<TableSchema | null>(null);
  const projectUpdaterRef = useRef<((dataset: Dataset) => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const datasetIdRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(null);

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

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const registerProjectUpdater = useCallback((updater: ((dataset: Dataset) => void) | null) => {
    projectUpdaterRef.current = updater;
  }, []);

  const registerDatasetId = useCallback((id: string | null) => {
    datasetIdRef.current = id;
    sessionIdRef.current = null;
  }, []);

  const registerProjectId = useCallback((id: string | null) => {
    projectIdRef.current = id;
  }, []);

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    setMessages([]);
  }, []);

  const onDatasetCreated = useCallback((dataset: Dataset) => {
    projectUpdaterRef.current?.(dataset);
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

      const toolHandler = toolHandlerRef.current;
      const tableSchema = tableSchemaRef.current;

      try {
        const apiMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
        }));

        const authHeaders = await refreshAuthHeadersIfExpiring();

        const fetchChat = (headers: Record<string, string>) =>
          fetch(`${CHAT_URL}/chat`, {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ messages: apiMessages, tableSchema }),
          });

        let response = await fetchChat(authHeaders);
        response = await retryOn401(response, fetchChat);

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

                case "done": {
                  let toolResults: Array<{ tool_call_id: string; result: string }> | null = null;
                  if (toolCalls.length > 0 && toolHandler) {
                    const results = await Promise.all(
                      toolCalls.map(async (tc) =>
                        toolHandler.executeToolCall(tc)
                      )
                    );
                    toolResults = toolCalls.map((tc, i) => ({ tool_call_id: tc.id, result: results[i] }));
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

                  // Fire-and-forget session logging
                  (async () => {
                    try {
                      if (!sessionIdRef.current && projectIdRef.current && datasetIdRef.current) {
                        const session = await createSession(projectIdRef.current, datasetIdRef.current);
                        sessionIdRef.current = session.id;
                      }
                      if (sessionIdRef.current && tableSchema) {
                        const systemPrompt = getSystemPrompt(tableSchema);
                        const toolDefs = getToolDefinitions(tableSchema);
                        await logTurn(sessionIdRef.current, {
                          user_message: userMessage.content as string,
                          system_prompt: systemPrompt,
                          tool_definitions: toolDefs,
                          assistant_content: accumulatedContent,
                          tool_calls: toolCalls.length > 0 ? toolCalls : null,
                          tool_results: toolResults,
                          table_schema: tableSchema,
                        });
                      }
                    } catch (err) {
                      console.error("Failed to log chat turn:", err);
                    }
                  })();

                  break;
                }
              }
            } catch (parseError) {
              if (parseError instanceof SyntaxError) {
                console.error("Parse error:", parseError);
              } else {
                throw parseError;
              }
            }
          }
        }
      } catch (error) {
        console.error("Chat error:", error);
        sessionIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Error: ${getErrorMessage(error)}`,
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
        addMessage,
        onDatasetCreated,
        registerProjectUpdater,
        registerDatasetId,
        registerProjectId,
        resetSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
