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
import type { Channel as StreamChannel } from "stream-chat";

import { withEagerAuth } from "@/auth";
import { createChatClient } from "@/chat";
import { readSSEStream } from "@/chat/services/chatStream";
import { executeToolCalls, type ToolHandler } from "@/chat/services/toolExecution";
import type { Dataset } from "@/dataCatalog";

export type { ToolHandler };

import { useStreamContext } from "@/stream/StreamProvider";
import { useEntityContext } from "@/stream/useEntityContext";
import { useSSEOverlay } from "@/stream/useSSEOverlay";

import { getErrorMessage } from "../../../../lib/errors";
import type { Message, TableSchema } from "../../../types";

const chatClient = createChatClient(withEagerAuth(fetch));

/** Entity context tracked independently of session state. */
export interface EntityContext {
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  tableSchema: TableSchema | null;
}

/** Values exposed by ChatContext to consumers via useChatContext. */
interface ChatContextValue {
  messages: Message[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  handleSubmit: (e: FormEvent) => void;
  handleStreamSubmit: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  chatEndRef: RefObject<HTMLDivElement>;
  registerToolHandler: (handler: ToolHandler | null) => void;
  registerTableSchema: (schema: TableSchema | null) => void;
  isActive: boolean;
  addMessage: (message: Message) => void;
  onDatasetCreated: (dataset: Dataset) => void;
  registerProjectUpdater: (
    updater: ((dataset: Dataset) => void) | null,
  ) => void;
  registerDatasetId: (datasetId: string | null) => void;
  registerProjectId: (projectId: string | null) => void;
  registerCurrentChannel: (channel: StreamChannel | null) => void;
  resetSession: () => void;
  isStreaming: boolean;
  streamingContent: string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Returns a patch function that updates the assistant message with the given id. */
function updateAssistantMessage(
  setMessages: Dispatch<SetStateAction<Message[]>>,
  id: string,
): (patch: Partial<Message>) => void {
  return (patch) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
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
  const projectUpdaterRef = useRef<((dataset: Dataset) => void) | null>(null);
  const currentChannelRef = useRef<StreamChannel | null>(null);

  // W3 fix: entity context tracks project, dataset, and table schema independently
  const entityContext = useEntityContext();

  const { isReady: streamReady } = useStreamContext();
  const sseOverlay = useSSEOverlay();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const registerToolHandler = useCallback((handler: ToolHandler | null) => {
    toolHandlerRef.current = handler;
    setIsActive(handler !== null);
  }, []);

  const registerTableSchema = useCallback((schema: TableSchema | null) => {
    entityContext.setTableSchema(schema);
  }, [entityContext]);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const registerProjectUpdater = useCallback(
    (updater: ((dataset: Dataset) => void) | null) => {
      projectUpdaterRef.current = updater;
    },
    [],
  );

  const registerDatasetId = useCallback((id: string | null) => {
    entityContext.setEntityId(id);
    entityContext.setEntityType(id ? "dataset" : null);
  }, [entityContext]);

  const registerProjectId = useCallback((id: string | null) => {
    entityContext.setProjectId(id);
  }, [entityContext]);

  const registerCurrentChannel = useCallback((channel: StreamChannel | null) => {
    currentChannelRef.current = channel;
  }, []);

  const resetSession = useCallback(() => {
    setMessages([]);
  }, []);

  const onDatasetCreated = useCallback((dataset: Dataset) => {
    projectUpdaterRef.current?.(dataset);
  }, []);

  /** Build API message history from Stream channel messages if available. */
  const buildApiMessages = useCallback(
    (userMessage: Message) => {
      // W2 fix: use currentChannelRef instead of activeChannels[0]
      const channel = currentChannelRef.current;
      if (channel && streamReady) {
        const streamMessages = channel.state.messages || [];
        const history = streamMessages.map((m) => ({
          role: m.user?.id === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.text || "",
          tool_calls: (m as Record<string, unknown>).custom
            ? ((m as Record<string, unknown>).custom as Record<string, unknown>)?.tool_calls as Message["tool_calls"]
            : undefined,
        }));
        // Append the current user message
        history.push({
          role: "user" as const,
          content: userMessage.content,
          tool_calls: undefined,
        });
        return history;
      }

      // Fallback: use in-memory messages
      return [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
      }));
    },
    [messages, streamReady],
  );

  /** Write a message to the current Stream channel. */
  const writeToStream = useCallback(
    async (text: string, role: "user" | "assistant", toolCalls?: Message["tool_calls"]) => {
      // W2 fix: use currentChannelRef instead of activeChannels[0]
      const channel = currentChannelRef.current;
      if (!channel || !streamReady) return;

      const messageData: Record<string, unknown> = { text };
      if (role === "assistant") {
        messageData.user_id = "assistant";
        if (toolCalls && toolCalls.length > 0) {
          messageData.custom = { tool_calls: toolCalls };
        }
      }

      try {
        await channel.sendMessage(messageData as Parameters<typeof channel.sendMessage>[0]);
      } catch (err) {
        console.error("Failed to write message to Stream:", err);
      }
    },
    [streamReady],
  );

  /**
   * Core submit logic extracted so both form submit and Stream MessageInput
   * can share the same SSE flow. Prevents W1 (duplicate messages).
   */
  const submitText = useCallback(
    async (text: string) => {
      const hasToolHandler = toolHandlerRef.current !== null;
      if (!text || isLoading || !hasToolHandler) return;

      const userMessage: Message = {
        id: String(Date.now()),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Write user message to Stream channel
      writeToStream(userMessage.content, "user");

      const assistantId = String(Date.now() + 1);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);

      const patchAssistant = updateAssistantMessage(setMessages, assistantId);
      const toolHandler = toolHandlerRef.current;
      const tableSchema = entityContext.tableSchema;

      // Start SSE overlay
      sseOverlay.startStreaming();

      try {
        const apiMessages = buildApiMessages(userMessage);

        const response = await chatClient.fetchChatStream(
          apiMessages,
          tableSchema,
        );

        await readSSEStream(response.body!, {
          onContent: (content) => {
            patchAssistant({ content });
            sseOverlay.updateContent(content);
          },
          onDone: async (accumulatedContent, toolCalls) => {
            // Stop SSE overlay
            sseOverlay.stopStreaming();

            let toolResults: Array<{
              tool_call_id: string;
              result: string;
            }> | null = null;

            if (toolCalls.length > 0 && toolHandler) {
              const { results, toolResults: tr } = await executeToolCalls(
                toolCalls,
                toolHandler,
              );
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

            // Write assistant message to Stream with tool_calls metadata
            writeToStream(
              accumulatedContent || (toolResults ? `Executed: ${toolResults.map((r) => r.result).join(", ")}` : ""),
              "assistant",
              toolCalls.length > 0 ? toolCalls : undefined,
            );
          },
        });
      } catch (error) {
        console.error("Chat error:", error);
        sseOverlay.stopStreaming();
        patchAssistant({
          content: `Error: ${getErrorMessage(error)}`,
          isStreaming: false,
        });
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, buildApiMessages, writeToStream, sseOverlay, entityContext],
  );

  /** Form submit handler (fallback non-Stream mode). */
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
      await submitText(text);
    },
    [input, submitText],
  );

  /** W1 fix: Override handler for Stream SDK's MessageInput — prevents default send. */
  const handleStreamSubmit = useCallback(
    (text: string) => {
      submitText(text);
    },
    [submitText],
  );

  return {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
    handleStreamSubmit,
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
    registerCurrentChannel,
    resetSession,
    isStreaming: sseOverlay.isStreaming,
    streamingContent: sseOverlay.streamingContent,
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

/** Provides SSE-based chat streaming, tool call execution, and Stream persistence. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const value = useChatEngine();

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
