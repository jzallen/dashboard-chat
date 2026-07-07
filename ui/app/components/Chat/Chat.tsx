/* Chat dock: the assistant overlay (live turn against the ui/ server broker). */
import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import type { Edge, LineageNode } from "../../catalog";
import { fmt } from "../../lib/fmt";
import { useNavIntents } from "../../lib/nav";
import { Icon, type IconName, LayerDot } from "../primitives";
import { catalog, useCatalog } from "../useCatalog";
import styles from "./Chat.module.css";
import { useChatTurn } from "./useChatTurn";

type ChatDockProps = {
  context: LineageNode | null;
  onCreate: (node: LineageNode, edge: Edge) => void;
  onClose: () => void;
  onOpenNode: (node: LineageNode) => void;
};

export function AssistantOverlay({ context, onClose }: ChatDockProps) {
  // Re-render the recents list when backend sessions land (catalog commit).
  useCatalog();
  const { go } = useNavIntents();
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
    <div
      className={`${styles.assistantOverlay}${closing ? " " + styles.aoOut : ""}`}
    >
      <div className={styles.aoHead}>
        <span className={styles.aoMark}>
          <Icon name="sparkle" size={15} />
        </span>
        <span className={styles.ct}>Assistant</span>
        {context ? (
          <span className={styles.chatCtx}>
            <LayerDot layer={context.layer} size={6} />
            {context.label}
            <span className={styles.chatCtxLayer}>{context.layer}</span>
          </span>
        ) : (
          <span className={styles.chatCtx}>No dataset in context</span>
        )}
        <div className={styles.aoActions}>
          <button className={styles.aoIconbtn} onClick={newSession}>
            <Icon name="plus" size={16} />
            <span className={styles.tip}>New session</span>
          </button>
          <button
            className={styles.aoIconbtn}
            onClick={() => closeWith(() => go({ name: "chats" }))}
          >
            <Icon name="clock" size={16} />
            <span className={styles.tip}>History &amp; search</span>
          </button>
          <button className={styles.aoIconbtn} onClick={() => closeWith()}>
            <Icon name="x" size={16} />
            <span className={styles.tip}>Close</span>
          </button>
        </div>
      </div>
      <div className={styles.aoBody} ref={bodyRef}>
        {msgs.length === 0 && (
          <>
            <div className={styles.aoSection}>
              <span className={styles.aoSecLabel}>Recent</span>
            </div>
            <div className={styles.aoRecents}>
              {catalog.listRecents().map((r) => {
                const node = r.nodeId ? catalog.getNode(r.nodeId) : null;
                return (
                  <button
                    key={r.nodeId ?? r.title}
                    className={`${styles.aoRecent}${node ? " layer-" + node.layer : ""}`}
                    onClick={() => go({ name: "openRecent", nodeId: r.nodeId })}
                  >
                    <span className={styles.aoRecDot}>
                      {node ? (
                        <LayerDot layer={node.layer} size={7} />
                      ) : (
                        <Icon name="chat" size={13} />
                      )}
                    </span>
                    <span className={styles.aoRecTitle}>{r.title}</span>
                    <Icon
                      name="arrow"
                      size={14}
                      style={{ color: "var(--text-400)", flex: "0 0 auto" }}
                    />
                  </button>
                );
              })}
            </div>
            <div className={styles.aoDivider}>
              <span>or start something new</span>
            </div>
            <div className={styles.suggest}>
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
          <div
            className={`${styles.msg} ${m.role === "user" ? styles.user : styles.bot}`}
            key={m.id}
          >
            <div
              className={styles.bubble}
              dangerouslySetInnerHTML={{ __html: fmt(m.text) }}
            />
          </div>
        ))}
        {typing && (
          <div className={`${styles.msg} ${styles.bot}`}>
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
      <div className={styles.aoInput}>
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
          className={styles.sendBtn}
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
