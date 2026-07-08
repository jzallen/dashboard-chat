/* The chat overlay dock: a live turn against the ui/ server broker. "Chat" is
   the feature (sessions, message bubbles); the assistant is the persona of the
   streamed bot replies shown inside it. */
import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import type { Edge, LineageNode } from "../../catalog";
import { useNavIntents } from "../../lib/nav";
import { Icon, type IconName, LayerDot } from "../primitives";
import { useCatalogContext, useCatalogSelector } from "../useCatalog";
import styles from "./Chat.module.css";
import { ChatBubble } from "./ChatBubble";
import { useChatTurn } from "./useChatTurn";

type ChatOverlayProps = {
  context: LineageNode | null;
  onCreate: (node: LineageNode, edge: Edge) => void;
  onClose: () => void;
  onOpenNode: (node: LineageNode) => void;
};

export function ChatOverlay({ context, onClose }: ChatOverlayProps) {
  const catalog = useCatalogContext();
  // Re-render the recents list when backend sessions land, and pick up the
  // revalidated chat-script prompt — the graph feeds each recent's node label.
  useCatalogSelector((s) => s.recents);
  useCatalogSelector((s) => s.chatScript);
  useCatalogSelector((s) => s.graph);
  const { navigateTo } = useNavIntents();
  const { revalidate } = useRevalidator();
  const { msgs, typing, busy, send, reset } = useChatTurn(context, revalidate);
  const [input, setInput] = useState("");
  const [closing, setClosing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeWith = (fn?: () => void) => {
    setClosing(true);
    setTimeout(() => {
      if (fn) fn();
      onClose();
    }, 200);
  };
  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, typing]);

  const newSession = () => {
    reset();
    setInput("");
  };
  const suggestions: { t: string; ic: IconName }[] = [
    { t: catalog.getChatScript().prompt, ic: "sparkle" },
    { t: "Join customers with their orders", ic: "join" },
    { t: "Roll up lifetime revenue per customer", ic: "layers" },
  ];

  return (
    <div className={`${styles.overlay}${closing ? " " + styles.closing : ""}`}>
      <div className={styles.header}>
        <span className={styles.mark}>
          <Icon name="sparkle" size={15} />
        </span>
        <span className={styles.title}>Assistant</span>
        {context ? (
          <span className={styles.context}>
            <LayerDot layer={context.layer} size={6} />
            {context.label}
            <span className={styles.contextLayer}>{context.layer}</span>
          </span>
        ) : (
          <span className={styles.context}>No dataset in context</span>
        )}
        <div className={styles.actions}>
          <button className={styles.iconButton} onClick={newSession}>
            <Icon name="plus" size={16} />
            <span className={styles.tooltip}>New session</span>
          </button>
          <button
            className={styles.iconButton}
            onClick={() => closeWith(() => navigateTo({ name: "chats" }))}
          >
            <Icon name="clock" size={16} />
            <span className={styles.tooltip}>History &amp; search</span>
          </button>
          <button className={styles.iconButton} onClick={() => closeWith()}>
            <Icon name="x" size={16} />
            <span className={styles.tooltip}>Close</span>
          </button>
        </div>
      </div>
      <div className={styles.body} ref={bodyRef}>
        {msgs.length === 0 && (
          <>
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Recent</span>
            </div>
            <div className={styles.recents}>
              {catalog.listRecents().map((r) => {
                const node = r.nodeId ? catalog.getNode(r.nodeId) : null;
                return (
                  <button
                    key={r.nodeId ?? r.title}
                    className={`${styles.recent}${node ? " layer-" + node.layer : ""}`}
                    onClick={() =>
                      navigateTo({ name: "openRecent", nodeId: r.nodeId })
                    }
                  >
                    <span className={styles.recentDot}>
                      {node ? (
                        <LayerDot layer={node.layer} size={7} />
                      ) : (
                        <Icon name="chat" size={13} />
                      )}
                    </span>
                    <span className={styles.recentTitle}>{r.title}</span>
                    <Icon
                      name="arrow"
                      size={14}
                      style={{ color: "var(--text-400)", flex: "0 0 auto" }}
                    />
                  </button>
                );
              })}
            </div>
            <div className={styles.divider}>
              <span>or start something new</span>
            </div>
            <div className={styles.suggestions}>
              {suggestions.map((s) => (
                <button key={s.t} onClick={() => send(s.t)}>
                  <Icon name={s.ic} size={16} />
                  {s.t}
                </button>
              ))}
            </div>
          </>
        )}
        {msgs.map((m) => (
          <ChatBubble key={m.id} m={m} />
        ))}
        {typing && (
          <div className={`${styles.message} ${styles.bot}`}>
            <div className={styles.bubble} style={{ padding: 0 }}>
              <div className={styles.typing}>
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className={styles.composer}>
        <textarea
          placeholder="Describe a transform, join or metric…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim()) {
                send(input.trim());
                setInput("");
              }
            }
          }}
        />
        <button
          className={styles.sendButton}
          disabled={busy || !input.trim()}
          onClick={() => {
            if (input.trim()) {
              send(input.trim());
              setInput("");
            }
          }}
        >
          <Icon name="send" size={17} />
        </button>
      </div>
    </div>
  );
}
