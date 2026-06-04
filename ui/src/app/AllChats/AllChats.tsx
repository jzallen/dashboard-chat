/* All-chats route page: every session across the project, searchable, each
   linking back to the model it was shaping. */
import { useState } from "react";

import { Icon } from "../primitives";
import { catalog } from "../useCatalog";
import styles from "./AllChats.module.css";

/** A nav request handed back to the app shell. */
type ChatRoute = { name: string; nodeId?: string | null };

export function AllChats({ go }: { go: (route: ChatRoute) => void }) {
  const [q, setQ] = useState("");
  const list = catalog
    .listChats()
    .filter((c) =>
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
        {list.map((c, i) => {
          const node = c.nodeId ? catalog.getNode(c.nodeId) : null;
          return (
            <button
              key={i}
              className={`${styles.chatRow}${node ? " layer-" + node.layer : ""}`}
              onClick={() =>
                go(
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
