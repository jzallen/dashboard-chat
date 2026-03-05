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

import { fetchChatStream } from "@/chat/client";
import type { Dataset } from "@/dataCatalog";
import type { ToolCall } from "@/table-tools";

import { getErrorMessage } from "../../../../errors";
import type { Message, TableSchema } from "../../../types";
import { readSSEStream } from "../services/chatStream";
import { logChatTurn } from "../services/sessionLogger";
import { executeToolCalls } from "../services/toolExecution";

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

/** Returns a patch function that updates the assistant message with the given id. */
function updateAssistantMessage(
  setMessages: Dispatch<SetStateAction<Message[]>>,
  id: string,
): (patch: Partial<Message>) => void {
  return (patch) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

// ---------------------------------------------------------------------------
// useChatEngine — all state and business logic for the chat provider
// ---------------------------------------------------------------------------

function useChatEngine(): ChatContextValue {
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

      const hasInput = input.trim().length > 0;
      const hasToolHandler = toolHandlerRef.current !== null;
      if (!hasInput || isLoading || !hasToolHandler) return;

      const userMessage: Message = { id: String(Date.now()), role: "user", content: input.trim() };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      const assistantId = String(Date.now() + 1);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);

      const patchAssistant = updateAssistantMessage(setMessages, assistantId);
      const toolHandler = toolHandlerRef.current;
      const tableSchema = tableSchemaRef.current;

      try {
        const apiMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
        }));

        const response = await fetchChatStream(apiMessages, tableSchema);

        await readSSEStream(response.body!, {
          onContent: (content) => patchAssistant({ content }),
          onDone: async (accumulatedContent, toolCalls) => {
            let toolResults: Array<{ tool_call_id: string; result: string }> | null = null;

            if (toolCalls.length > 0 && toolHandler) {
              const { results, toolResults: tr } = await executeToolCalls(toolCalls, toolHandler);
              toolResults = tr;
              const toolSummary = results.join(", ");
              patchAssistant({
                content: accumulatedContent || `Executed: ${toolSummary}`,
                tool_calls: toolCalls,
                isStreaming: false,
              });
            } else {
              patchAssistant({ isStreaming: false });
            }

            // Fire-and-forget session logging
            logChatTurn(
              sessionIdRef, projectIdRef, datasetIdRef,
              tableSchema, userMessage.content, accumulatedContent,
              toolCalls, toolResults,
            );
          },
        });
      } catch (error) {
        console.error("Chat error:", error);
        sessionIdRef.current = null;
        patchAssistant({ content: `Error: ${getErrorMessage(error)}`, isStreaming: false });
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [input, isLoading, messages],
  );

  return {
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
  };
}

// ---------------------------------------------------------------------------
// Context + Provider + consumer hook
// ---------------------------------------------------------------------------

/** Consumes the ChatContext. Must be used within a ChatProvider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}

/** Provides SSE-based chat streaming, tool call execution, and session management. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const value = useChatEngine();

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}
