import { useQueryClient } from "@tanstack/react-query";
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

import { withAuth, withEagerAuth } from "@/auth";
import { createChatClient } from "@/chat";
import type { TableApi } from "@/chat/dispatcher";
import { handleChatEvent } from "@/chat/eventHandler";
import type { AgentRequest } from "@/chat/services/chatStream";
import { readSSEStream } from "@/chat/services/chatStream";
import { fulfillAgentRequest } from "@/chat/services/fulfillRequest";
import { type ToolHandler } from "@/chat/services/toolExecution";
import { createDataCatalog, type Dataset, type Session } from "@/dataCatalog";

export type { ToolHandler };

import { useStreamContext } from "@/stream/StreamProvider";
import { useEntityContext } from "@/stream/useEntityContext";
import { useSSEOverlay } from "@/stream/useSSEOverlay";

import { getErrorMessage } from "../../../../lib/errors";
import type { Message, TableSchema } from "../../../types";

const chatClient = createChatClient(withEagerAuth(fetch));
const catalog = createDataCatalog(withAuth(fetch));

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
  registerTableApi: (api: TableApi | null) => void;
  registerTableSchema: (schema: TableSchema | null) => void;
  addMessage: (message: Message) => void;
  onDatasetCreated: (dataset: Dataset) => void;
  registerProjectUpdater: (
    updater: ((dataset: Dataset) => void) | null,
  ) => void;
  /** @deprecated Use setContext instead */
  registerDatasetId: (datasetId: string | null) => void;
  registerProjectId: (projectId: string | null) => void;
  setContext: (type: "dataset" | "view" | null, id: string | null) => void;
  channel: StreamChannel | null;
  session: Session | null;
  createSession: (projectId: string) => Promise<Session>;
  loadSession: (projectId: string, sessionId: string) => Promise<Session>;
  /** @deprecated Use createSession/loadSession instead */
  createChannel: (orgId: string) => Promise<StreamChannel>;
  /** @deprecated Use createSession/loadSession instead */
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
  const [session, setSession] = useState<Session | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null!);
  const inputRef = useRef<HTMLInputElement>(null!);
  const toolHandlerRef = useRef<ToolHandler | null>(null);
  const tableApiRef = useRef<TableApi | null>(null);
  const projectUpdaterRef = useRef<((dataset: Dataset) => void) | null>(null);
  const queryClient = useQueryClient();
  const channelRef = useRef<StreamChannel | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const pendingCommandRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(null);

  // W3 fix: entity context tracks project, dataset, and table schema independently
  const entityContext = useEntityContext();

  const { isReady: streamReady, client: streamClient } = useStreamContext();
  const sseOverlay = useSSEOverlay();

  // Keep refs in sync with state for use in stable callbacks
  channelRef.current = channel;
  sessionRef.current = session;
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

  const registerTableApi = useCallback((api: TableApi | null) => {
    tableApiRef.current = api;
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

  const setContext = useCallback((type: "dataset" | "view" | null, id: string | null) => {
    entityContext.setContext(type, id);
    // Update channel custom data
    if (channelRef.current) {
      channelRef.current.updatePartial({
        set: { contextType: type, contextId: id },
      }).catch(console.error);
    }
  }, [entityContext]);

  /** @deprecated Use setContext instead */
  const registerDatasetId = useCallback((id: string | null) => {
    entityContext.setEntityId(id);
    entityContext.setEntityType(id ? "dataset" : null);
  }, [entityContext]);

  const registerProjectId = useCallback((id: string | null) => {
    entityContext.setProjectId(id);
    projectIdRef.current = id;
  }, [entityContext]);

  /** Create a session via the backend API, then watch the Stream thread. */
  const createSessionFn = useCallback(
    async (projectId: string): Promise<Session> => {
      const newSession = await catalog.createSession(projectId);

      // Watch the Stream thread if the client is available
      if (streamClient && newSession.stream_thread_id) {
        try {
          const memory = await catalog.getProjectMemory(projectId);
          const ch = streamClient.channel("messaging", memory.stream_channel_id);
          await ch.watch();
          setChannel(ch);
        } catch (err) {
          console.error("Failed to watch memory channel:", err);
        }
      }

      setSession(newSession);
      setMessages([]);
      projectIdRef.current = projectId;
      return newSession;
    },
    [streamClient],
  );

  /** Load an existing session by fetching its thread from Stream. */
  const loadSessionFn = useCallback(
    async (projectId: string, sessionId: string): Promise<Session> => {
      // Fetch sessions list to find the session metadata
      const sessionsPage = await catalog.listSessions(projectId, { size: 100 });
      const sessionData = sessionsPage.data.find((s) => s.id === sessionId);
      if (!sessionData) throw new Error(`Session ${sessionId} not found`);

      // Watch the Stream channel/thread if available
      if (streamClient && sessionData.stream_thread_id) {
        try {
          const memory = await catalog.getProjectMemory(projectId);
          const ch = streamClient.channel("messaging", memory.stream_channel_id);
          await ch.watch();
          setChannel(ch);

          // Restore context from channel custom data
          const channelData = ch.data as Record<string, unknown> | undefined;
          const contextType = channelData?.contextType as "dataset" | "view" | "report" | null | undefined;
          const contextId = channelData?.contextId as string | null | undefined;
          if (contextType && contextId) {
            setContext(contextType, contextId);
          }

          // Load messages from Stream thread
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
        } catch (err) {
          console.error("Failed to watch session thread:", err);
        }
      }

      setSession(sessionData);
      projectIdRef.current = projectId;
      return sessionData;
    },
    [streamClient, setContext],
  );

  /** @deprecated Legacy channel creation for backward compat. Use createSession instead. */
  const createChannel = useCallback(
    async (orgId: string): Promise<StreamChannel> => {
      if (!streamClient) throw new Error("Stream client not ready");

      const { sessionHash, compactId } = await import("@/stream/channelId");
      const userId = streamClient.userID ?? "anon";
      const suffix = await sessionHash(orgId, userId);
      const sessionId = `chat_${compactId(orgId)}_${suffix}`;

      const ch = streamClient.channel("messaging", sessionId, {
        orgId,
        projectId: null,
        datasetId: null,
        contextType: null,
        contextId: null,
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

  /** @deprecated Legacy channel loading for backward compat. Use loadSession instead. */
  const loadChannel = useCallback(
    async (channelId: string): Promise<StreamChannel> => {
      if (!streamClient) throw new Error("Stream client not ready");

      const ch = streamClient.channel("messaging", channelId);
      await ch.watch();

      setChannel(ch);

      // Restore context from channel custom data (with legacy fallback)
      const channelData = ch.data as Record<string, unknown> | undefined;
      const contextType = channelData?.contextType as "dataset" | "view" | "report" | null | undefined;
      const contextId = channelData?.contextId as string | null | undefined;
      if (contextType && contextId) {
        setContext(contextType, contextId);
      } else {
        // Legacy fallback: if no contextType but datasetId is present, treat as dataset
        const datasetId = channelData?.datasetId as string | undefined;
        if (datasetId) {
          setContext("dataset", datasetId);
        }
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
    [streamClient, setContext],
  );

  const setTitle = useCallback(
    (title: string) => {
      // Update via backend API if we have a session
      const currentSession = sessionRef.current;
      const currentProjectId = projectIdRef.current;
      if (currentSession && currentProjectId) {
        catalog
          .updateSession(currentProjectId, currentSession.id, { title })
          .catch(console.error);
      }
      // Also update Stream channel for backward compat
      if (channelRef.current) {
        channelRef.current.updatePartial({ set: { title } }).catch(console.error);
      }
    },
    [],
  );

  const resetSession = useCallback(() => {
    setChannel(null);
    setSession(null);
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
      if (messagesRef.current.length === 0) {
        const titleText = text.slice(0, 100);
        // Update via backend API
        const currentSession = sessionRef.current;
        const currentProjectId = projectIdRef.current;
        if (currentSession && currentProjectId) {
          catalog
            .updateSession(currentProjectId, currentSession.id, { title: titleText })
            .catch(console.error);
        }
        // Also update Stream channel for backward compat
        if (channelRef.current) {
          channelRef.current.updatePartial({ set: { title: titleText } }).catch(console.error);
        }
      }

      // Detect table operations that need a dataset context
      const hasDataset = !!entityContext.entityId || !!(channelRef.current?.data as Record<string, unknown>)?.datasetId;
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
      const contextType = entityContext.entityType;
      const contextId = entityContext.entityId;
      const tableSchema = (contextType === "dataset" || contextType === "report") ? entityContext.tableSchema : null;

      // Start SSE overlay
      sseOverlay.startStreaming();

      try {
        const apiMessages = buildApiMessages(userMessage);

        const response = await chatClient.fetchChatStream(
          apiMessages,
          tableSchema,
          contextType,
          contextId,
        );

        await readSSEStream(response.body!, {
          onContent: (content) => {
            patchAssistant({ content });
            sseOverlay.updateContent(content);
          },
          onChatEvent: (event) => {
            const table = tableApiRef.current;
            if (!table) return;
            handleChatEvent(event, {
              queryClient,
              table,
              toast: {
                error: (msg) => console.error("[chat]", msg),
              },
              thinking: { setVisible: (_v) => {} },
            });
          },
          onDone: (accumulatedContent) => {
            // v6: tool execution is handled agent-side via `data-chat-event` parts;
            // `readSSEStream` always reports `toolCalls: []` to `onDone`. The legacy
            // FE-side execute branch was removed (see chatStream.ts:106-110).
            sseOverlay.stopStreaming();
            patchAssistant({ isStreaming: false });
            writeToStream(accumulatedContent || "", "assistant");
          },
          onRequest: async (agentReq: AgentRequest) => {
            sseOverlay.stopStreaming();
            const projectId = projectIdRef.current;
            if (!projectId) {
              patchAssistant({ content: "No project selected. Please select a project first.", isStreaming: false });
              return;
            }
            const fulfillResult = await fulfillAgentRequest(agentReq, projectId, withEagerAuth(fetch));
            if (fulfillResult.error) {
              patchAssistant({ content: fulfillResult.error, isStreaming: false });
            } else if (fulfillResult.dataset) {
              entityContext.setContext("dataset", fulfillResult.dataset.id);
              patchAssistant({ content: `Resolved dataset: ${fulfillResult.dataset.name}`, isStreaming: false });
              // Store for re-submit after this stream finishes and isLoading resets
              pendingCommandRef.current = text;
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

        // Re-submit if a dataset was resolved during the stream
        const pendingResubmit = pendingCommandRef.current;
        if (pendingResubmit) {
          pendingCommandRef.current = null;
          // Defer to next tick so isLoading=false takes effect first
          setTimeout(() => submitText(pendingResubmit), 0);
        }
      }
    },
    // Note: submitText is called recursively via setTimeout (line 576) but must NOT
    // appear in its own dependency array — doing so causes a ReferenceError at init time.
     
    [isLoading, buildApiMessages, writeToStream, sseOverlay, entityContext, queryClient],
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
        channelRef.current.updatePartial({ set: { datasetId, contextType: "dataset", contextId: datasetId } }).catch(console.error);
      }

      // Register dataset context
      registerDatasetId(datasetId);

      // Re-submit the pending command if one was stored
      const pendingCommand = pendingCommandRef.current;
      // US-209 / MR-5: hand the dataset pick to J-002 so the session-chat
      // machine owns the resolution (it runs ScopeResolver invariant 4,
      // retargets active_scope.resource_*, and persists
      // session.active_dataset_id). A stored pending command means this
      // pick came from the agent's resolve_dataset tool-return path
      // (`data-agent-request`) → `dataset_resolved_by_agent`; otherwise it
      // is a direct UI selection → `dataset_picked_directly`. Best-effort
      // and non-blocking — the full ownership contract is validated at the
      // ui-state acceptance layer (US-209). Per DWD-13 J-002 RETIRES the
      // FE's parallel dataset state; this is only the emit seam.
      emitDatasetPickToJ002(
        datasetId,
        pendingCommand ? "dataset_resolved_by_agent" : "dataset_picked_directly",
      );
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
    registerTableApi,
    registerTableSchema,
    addMessage,
    onDatasetCreated,
    registerProjectUpdater,
    registerDatasetId,
    registerProjectId,
    setContext,
    channel,
    session,
    createSession: createSessionFn,
    loadSession: loadSessionFn,
    createChannel,
    loadChannel,
    setTitle,
    resetSession,
    handleDatasetSelected,
    isStreaming: sseOverlay.isStreaming,
    streamingContent: sseOverlay.streamingContent,
  };
}

/**
 * US-209 / MR-5 — emit a dataset pick to the J-002 session-chat machine.
 *
 * Best-effort, fire-and-forget, browser-only. J-002 owns the dataset
 * resolution end-to-end (ScopeResolver invariant 4 → active_scope.resource_*
 * → session.active_dataset_id); this is purely the FE emit seam. The flow
 * principal is read from the app-exposed global (set by the SSR shell from
 * the verified identity); when it is absent — e.g. unit tests, or a build
 * that has not wired it — this is a silent no-op so the existing chat
 * re-submit flow is never blocked or made to throw (DWD-13: J-002 retires
 * the FE's parallel dataset state, the FE does not re-own it here).
 */
function emitDatasetPickToJ002(
  datasetId: string,
  type: "dataset_resolved_by_agent" | "dataset_picked_directly",
): void {
  try {
    const principal = (
      globalThis as { __J002_PRINCIPAL_ID__?: unknown }
    ).__J002_PRINCIPAL_ID__;
    if (
      typeof principal !== "string" ||
      principal.length === 0 ||
      typeof fetch !== "function"
    ) {
      return;
    }
    void fetch("/ui-state/flow/session-chat/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flow_id: `session-chat:${principal}`,
        type,
        payload: { resource_id: datasetId, resource_type: "dataset" },
      }),
    }).catch(() => {
      /* J-002 emit is best-effort; never surfaces to the user */
    });
  } catch {
    /* never let the emit seam break dataset selection */
  }
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
