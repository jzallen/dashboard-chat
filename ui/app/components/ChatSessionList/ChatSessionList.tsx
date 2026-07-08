/* Chat-session list route page (user-facing /chats): every session across the
   project, searchable, each linking back to the model it was shaping. */
import { useState } from "react";

import { useNavIntents } from "../../lib/nav";
import { Icon } from "../primitives";
import { useCatalogContext, useCatalogWithSelector } from "../useCatalog";
import styles from "./ChatSessionList.module.css";

export function ChatSessionList() {
  const { navigateTo } = useNavIntents();
  const [q, setQ] = useState("");
  const catalog = useCatalogContext();
  // Re-render when backend sessions land (getAllChats resolves a beat after
  // first paint), or when the graph mutates — each row reads its backing node's
  // label off the graph.
  const chats = useCatalogWithSelector((s) => s.chats);
  useCatalogWithSelector((s) => s.graph);
  const list = chats.filter((c) =>
    (c.title + " " + (c.snippet ?? ""))
      .toLowerCase()
      .includes(q.trim().toLowerCase()),
  );
  return (
    <div className={styles.chatsPage}>
      <h1 className={styles.chatsTitle}>All Chats</h1>
      <p className={styles.chatsSubtitle}>
        Every session across this project — jump back into the model it was
        shaping.
      </p>
      <div className={styles.chatsSearch}>
        <Icon name="search" size={16} />
        <input
          placeholder="Search chats…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className={styles.chatsList}>
        {list.map((c) => {
          const node = c.nodeId ? catalog.getNode(c.nodeId) : null;
          return (
            <button
              key={`${c.nodeId ?? c.title}-${c.when ?? ""}`}
              className={`${styles.chatRow}${node ? " layer-" + node.layer : ""}`}
              onClick={() =>
                navigateTo(
                  c.nodeId
                    ? { name: "openRecent", nodeId: c.nodeId }
                    : { name: "chat" },
                )
              }
            >
              <span className={`${styles.crIc}${node ? " " + styles.ctx : ""}`}>
                <Icon name={node ? "layers" : "chat"} size={17} />
              </span>
              <span className={styles.crMain}>
                <span className={styles.crTitle}>
                  {c.title}
                  {node && <span className={styles.crModel}>{node.label}</span>}
                </span>
                <span className={styles.crSnip}>{c.snippet}</span>
              </span>
              <span className={styles.crWhen}>{c.when}</span>
            </button>
          );
        })}
        {list.length === 0 && (
          <div className={styles.chatsEmpty}>No chats match “{q}”.</div>
        )}
      </div>
    </div>
  );
}
