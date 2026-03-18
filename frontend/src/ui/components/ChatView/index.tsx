import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";

import { useChatContext } from "../../context/ChatContext";
import type { AppShellContext } from "../AppShell";
import { ChatInput, MessageList, WelcomeState } from "../chat";
import styles from "./ChatView.module.css";

/** Full-width chat interface. Creates a new session at `/`, resumes at `/chat/:channelId`. */
export function ChatView() {
  const { channelId } = useParams<{ channelId?: string }>();
  const { orgId } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  const {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
    chatEndRef,
    channel,
    createChannel,
    loadChannel,
    addMessage,
    registerDatasetId,
  } = useChatContext();

  const [isInitializing, setIsInitializing] = useState(true);
  const initRef = useRef(false);
  const prevChannelIdRef = useRef(channelId);

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
          // Resume existing session
          if (channel?.id !== channelId) {
            await loadChannel(channelId);
          }
        } else if (orgId) {
          // Create new session and redirect
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
  }, [channelId, orgId, channel, createChannel, loadChannel, navigate]);

  // Resolve dataset name from channel custom data
  const datasetId = (channel?.data as Record<string, unknown>)?.datasetId as string | undefined;

  if (isInitializing && !channel) {
    return <div className={styles.loading}>Starting session...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.contentColumn}>
        {messages.length === 0 ? (
          <div className={styles.welcomeArea}>
            <WelcomeState
              onUploadCsv={() =>
                addMessage({
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "Which project would you like to upload to?",
                  widget: { type: "upload" },
                })
              }
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
            onClearDataset={datasetId ? () => {
              channel?.updatePartial({ set: { datasetId: null } }).catch(console.error);
              registerDatasetId(null);
            } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
