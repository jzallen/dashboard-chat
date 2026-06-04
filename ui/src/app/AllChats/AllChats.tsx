/* All-chats route page: every session across the project, searchable, each
   linking back to the model it was shaping. */
import { useState } from "react";

import { catalog } from "../fixtureSource";
import { Icon } from "../primitives";

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
    <div className="chats-page">
      <h1 className="chats-title">All Chats</h1>
      <p className="chats-subtitle">
        Every session across this project — jump back into the model it was
        shaping.
      </p>
      <div className="chats-search">
        <Icon name="search" size={16} />
        <input
          placeholder="Search chats…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="chats-list">
        {list.map((c, i) => {
          const node = c.nodeId ? catalog.getNode(c.nodeId) : null;
          return (
            <button
              key={i}
              className={"chat-row" + (node ? " layer-" + node.layer : "")}
              onClick={() =>
                go(
                  c.nodeId
                    ? { name: "openRecent", nodeId: c.nodeId }
                    : { name: "chat" },
                )
              }
            >
              <span className={"cr-ic" + (node ? " ctx" : "")}>
                <Icon name={node ? "layers" : "chat"} size={17} />
              </span>
              <span className="cr-main">
                <span className="cr-title">
                  {c.title}
                  {node && <span className="cr-model">{node.label}</span>}
                </span>
                <span className="cr-snip">{c.snippet}</span>
              </span>
              <span className="cr-when">{c.when}</span>
            </button>
          );
        })}
        {list.length === 0 && (
          <div className="chats-empty">No chats match “{q}”.</div>
        )}
      </div>
    </div>
  );
}
