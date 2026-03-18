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

import { compactId, sessionHash } from "@/stream/channelId";
import { useStreamContext } from "@/stream/StreamProvider";
import { useEntityContext } from "@/stream/useEntityContext";
import { useSSEOverlay } from "@/stream/useSSEOverlay";

import { getErrorMessage } from "../../../../lib/errors";
import type { Message, TableSchema } from "../../../types";

const chatClient = createChatClient(withEagerAuth(fetch));

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
  addMessage: (message: Message) => void;
  onDatasetCreated: (dataset: Dataset) => void;
  registerProjectUpdater: (
    updater: ((dataset: Dataset) => void) | null,
  ) => void;
  registerDatasetId: (datasetId: string | null) => void;
  registerProjectId: (projectId: string | null) => void;
  channel: StreamChannel | null;
  createChannel: (orgId: string) => Promise<StreamChannel>;
  loadChannel: (channelId: string) => Promise<StreamChannel>;
  setTitle: (title: string) => void;
  resetSession: () => void;
  handleDatasetSelected: (datasetId: string) => void;
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

/** Keywords that suggest the user intends a table operation requiring a dataset. */
const TABLE_OP_KEYWORDS = ["filter", "sort", "add row", "delete", "clean", "show", "column"];

function looksLikeTableOperation(text: string): boolean {
  const lower = text.toLowerCase();
  return TABLE_OP_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// useChatEngine — all state and business logic for the chat provider
// ---------------------------------------------------------------------------

function useChatEngine(): ChatContextValue {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [channel, setChannel] = useState<StreamChannel | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null!);
  const inputRef = useRef<HTMLInputElement>(null!);
  const toolHandlerRef = useRef<ToolHandler | null>(null);
  const projectUpdaterRef = useRef<((dataset: Dataset) => void) | null>(null);
  const channelRef = useRef<StreamChannel | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const pendingCommandRef = useRef<string | null>(null);

  // W3 fix: entity context tracks project, dataset, and table schema independently
  const entityContext = useEntityContext();

  const { isReady: streamReady, client: streamClient } = useStreamContext();
  const sseOverlay = useSSEOverlay();

  // Keep refs in sync with state for use in stable callbacks
  channelRef.current = channel;
  messagesRef.current = messages;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Sync incoming Stream messages into local state (handles hydration race + live updates)
  useEffect(() => {
    if (!channel) return;

    const handleMessageNew = (event: { message?: { id?: string; user?: { id?: string }; text?: string } }) => {
      if (!event.message) return;
      const incoming: Message = {
        id: event.message.id || String(Date.now()),
        role: event.message.user?.id === "assistant" ? "assistant" : "user",
        content: event.message.text || "",
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev; // deduplicate
        return [...prev, incoming];
      });
    };

    channel.on("message.new", handleMessageNew);
    return () => { channel.off("message.new", handleMessageNew); };
  }, [channel]);

  const registerToolHandler = useCallback((handler: ToolHandler | null) => {
    toolHandlerRef.current = handler;
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

  const createChannel = useCallback(
    async (orgId: string): Promise<StreamChannel> => {
      if (!streamClient) throw new Error("Stream client not ready");

      const userId = streamClient.userID ?? "anon";
      const suffix = await sessionHash(orgId, userId);
      const sessionId = `chat_${compactId(orgId)}_${suffix}`;

      const ch = streamClient.channel("messaging", sessionId, {
        orgId,
        projectId: null,
        datasetId: null,
        title: null,
        createdAt: new Date().toISOString(),
      });
      await ch.watch();

      setChannel(ch);
      setMessages([]);
      return ch;
    },
    [streamClient],
  );

  const loadChannel = useCallback(
    async (channelId: string): Promise<StreamChannel> => {
      if (!streamClient) throw new Error("Stream client not ready");

      const ch = streamClient.channel("messaging", channelId);
      await ch.watch();

      setChannel(ch);

      // Restore dataset context from channel custom data
      const datasetId = ch.data?.datasetId;
      if (datasetId) {
        registerDatasetId(datasetId);
      }

      // Populate messages from channel history
      const streamMessages = ch.state.messages || [];
      const loadedMessages: Message[] = streamMessages.map((m, i) => ({
        id: m.id || String(i),
        role: m.user?.id === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.text || "",
        tool_calls: (m as Record<string, unknown>).custom
          ? ((m as Record<string, unknown>).custom as Record<string, unknown>)?.tool_calls as Message["tool_calls"]
          : undefined,
      }));
      setMessages(loadedMessages);
      return ch;
    },
    [streamClient, registerDatasetId],
  );

  const setTitle = useCallback(
    (title: string) => {
      if (!channel) return;
      channel.updatePartial({ set: { title } }).catch(console.error);
    },
    [channel],
  );

  const resetSession = useCallback(() => {
    setChannel(null);
    setMessages([]);
  }, []);

  const onDatasetCreated = useCallback((dataset: Dataset) => {
    projectUpdaterRef.current?.(dataset);
  }, []);

  /** Build API message history from Stream channel messages if available. */
  const buildApiMessages = useCallback(
    (userMessage: Message) => {
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
    [messages, streamReady, channel],
  );

  /** Write a message to the current Stream channel. */
  const writeToStream = useCallback(
    async (text: string, role: "user" | "assistant", toolCalls?: Message["tool_calls"]) => {
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
    [streamReady, channel],
  );

  /**
   * Core submit logic — no gating on toolHandler.
   * Sends messages regardless of whether a tool handler is registered.
   */
  const submitText = useCallback(
    async (text: string) => {
      if (!text || isLoading) return;

      const userMessage: Message = {
        id: String(Date.now()),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Write user message to Stream channel
      writeToStream(userMessage.content, "user");

      // Auto-set title from first message in a new session
      if (channelRef.current && messagesRef.current.length === 0) {
        channelRef.current.updatePartial({ set: { title: text.slice(0, 100) } }).catch(console.error);
      }

      // Detect table operations that need a dataset context
      const hasDataset = !!channelRef.current?.data?.datasetId || !!entityContext.entityId;
      if (looksLikeTableOperation(text) && !hasDataset) {
        pendingCommandRef.current = text;
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now() + 1),
            role: "assistant",
            content: "Please select a dataset to work with:",
            widget: { type: "dataset-picker" },
          },
        ]);
        setIsLoading(false);
        return;
      }

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

            if (toolCalls.length > 0 && toolHandler) {
              const { results, toolResults } = await executeToolCalls(
                toolCalls,
                toolHandler,
              );
              const toolSummary = results.join(", ");
              patchAssistant({
                content: accumulatedContent || `Executed: ${toolSummary}`,
                tool_calls: toolCalls,
                isStreaming: false,
              });

              // Write assistant message to Stream with tool_calls metadata
              writeToStream(
                accumulatedContent || (toolResults ? `Executed: ${toolResults.map((r) => r.result).join(", ")}` : ""),
                "assistant",
                toolCalls,
              );
            } else if (toolCalls.length > 0 && !toolHandler) {
              // Tool calls returned but no handler — prompt user to navigate to table
              const datasetId = entityContext.entityId;
              const navMessage = datasetId
                ? `Navigate to the table view to execute this operation: /table/${datasetId}`
                : "Select a dataset first to execute table operations.";
              patchAssistant({
                content: accumulatedContent
                  ? `${accumulatedContent}\n\n${navMessage}`
                  : navMessage,
                tool_calls: toolCalls,
                isStreaming: false,
              });

              writeToStream(
                accumulatedContent || navMessage,
                "assistant",
                toolCalls,
              );
            } else {
              patchAssistant({ isStreaming: false });

              // Write assistant message to Stream
              writeToStream(accumulatedContent || "", "assistant");
            }
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

  /** Form submit handler. */
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

  /** Override handler for Stream SDK's MessageInput. */
  const handleStreamSubmit = useCallback(
    (text: string) => {
      submitText(text);
    },
    [submitText],
  );

  /** Called when user picks a dataset from the inline DatasetPicker widget. */
  const handleDatasetSelected = useCallback(
    (datasetId: string) => {
      // Update channel custom data with the selected dataset
      if (channelRef.current) {
        channelRef.current.updatePartial({ set: { datasetId } }).catch(console.error);
      }

      // Register dataset context
      registerDatasetId(datasetId);

      // Re-submit the pending command if one was stored
      const pendingCommand = pendingCommandRef.current;
      if (pendingCommand) {
        pendingCommandRef.current = null;
        submitText(pendingCommand);
      }
    },
    [registerDatasetId, submitText],
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
    addMessage,
    onDatasetCreated,
    registerProjectUpdater,
    registerDatasetId,
    registerProjectId,
    channel,
    createChannel,
    loadChannel,
    setTitle,
    resetSession,
    handleDatasetSelected,
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
