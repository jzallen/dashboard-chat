import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";

import { withAuth } from "@/auth";
import { createDataCatalog } from "@/dataCatalog";

import { useChatContext } from "../../context/ChatContext";
import type { AppShellContext } from "../AppShell";
import { ChatInput, MessageList, WelcomeState } from "../chat";
import styles from "./ChatView.module.css";

const catalog = createDataCatalog(withAuth(fetch));

/** Full-width chat interface. Creates a new session at `/`, resumes at `/chat/:channelId`. */
export function ChatView() {
  const { channelId } = useParams<{ channelId?: string }>();
  const { orgId, projects } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  const {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
    chatEndRef,
    channel,
    session,
    createSession,
    loadSession,
    createChannel,
    loadChannel,
    addMessage,
    setContext,
  } = useChatContext();

  const [isInitializing, setIsInitializing] = useState(true);
  const initRef = useRef(false);
  const prevChannelIdRef = useRef(channelId);

  // Determine the default project for new sessions
  const defaultProjectId = projects?.[0]?.id;

  // Reset init guard when channelId changes (e.g. navigating from /chat/abc to /)
  if (prevChannelIdRef.current !== channelId) {
    prevChannelIdRef.current = channelId;
    initRef.current = false;
    setIsInitializing(true);
  }

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    let cancelled = false;

    async function init() {
      try {
        if (channelId) {
          // Resume existing session — try backend session first, fall back to legacy channel
          if (defaultProjectId) {
            try {
              if (session?.id !== channelId) {
                await loadSession(defaultProjectId, channelId);
              }
            } catch {
              // Fall back to legacy channel loading
              if (channel?.id !== channelId) {
                await loadChannel(channelId);
              }
            }
          } else if (channel?.id !== channelId) {
            await loadChannel(channelId);
          }
        } else if (defaultProjectId) {
          // Create new session via backend API
          const newSession = await createSession(defaultProjectId);
          if (!cancelled) {
            navigate(`/chat/${newSession.id}`, { replace: true });
          }
        } else if (orgId) {
          // Fallback: create legacy channel
          const ch = await createChannel(orgId);
          if (!cancelled) {
            navigate(`/chat/${ch.id}`, { replace: true });
          }
        }
      } catch (err) {
        console.error("ChatView init error:", err);
      }
      if (!cancelled) setIsInitializing(false);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [channelId, orgId, defaultProjectId, channel, session, createSession, loadSession, createChannel, loadChannel, navigate]);

  // Resolve context from channel custom data (with legacy fallback)
  const channelData = channel?.data as Record<string, unknown> | undefined;
  const contextType = (channelData?.contextType as "dataset" | "view" | null) ?? null;
  const contextId = (channelData?.contextId as string | null) ?? null;
  // Legacy fallback
  const datasetId = contextType === "dataset"
    ? contextId
    : (channelData?.datasetId as string | undefined) ?? undefined;

  const handleUploadCsv = useCallback(async () => {
    try {
      const projectList = await catalog.listProjects();
      if (projectList.length === 1) {
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Upload your file below.",
          widget: { type: "file-upload", projectId: projectList[0].id },
        });
      } else {
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Which project would you like to upload to?",
          widget: { type: "upload" },
        });
      }
    } catch (err) {
      console.error("Failed to fetch projects for upload:", err);
    }
  }, [addMessage]);

  if (isInitializing && !channel && !session) {
    return <div className={styles.loading}>Starting session...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.contentColumn}>
        {messages.length === 0 ? (
          <div className={styles.welcomeArea}>
            <WelcomeState
              onUploadCsv={handleUploadCsv}
              onBrowseProjects={() => navigate("/projects")}
            />
          </div>
        ) : (
          <div className={styles.messageArea}>
            <MessageList messages={messages} chatEndRef={chatEndRef} />
          </div>
        )}
        <div className={styles.inputArea}>
          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            datasetName={datasetId ?? undefined}
            contextType={contextType}
            contextLabel={contextId ?? undefined}
            onClearContext={(contextType || datasetId) ? () => {
              setContext(null, null);
              channel?.updatePartial({ set: { datasetId: null, contextType: null, contextId: null } }).catch(console.error);
            } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
