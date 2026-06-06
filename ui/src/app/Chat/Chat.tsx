/* Chat dock (scripted creation): the assistant overlay and its terminal variant. */
import { useEffect, useRef, useState } from "react";

import type { AuditTag, Edge, LineageNode } from "../../lib/catalog";
import { Icon, type IconName, LayerDot, TAG_ICON } from "../primitives";
import { catalog, useCatalog } from "../useCatalog";
import styles from "./Chat.module.css";

/** A nav request handed back to the app shell (e.g. open history or a recent). */
type ChatRoute = { name: string; nodeId?: string | null };

type ChatDockProps = {
  context: LineageNode | null;
  onCreate: (node: LineageNode, edge: Edge) => void;
  onClose: () => void;
  onOpenNode: (node: LineageNode) => void;
  go: (route: ChatRoute) => void;
};

/** A message in the overlay transcript: prose bubbles or a tool-action card. */
type ChatMsg =
  | { role: "user" | "bot"; text: string }
  | { role: "tool"; say: string; tag: AuditTag };

/** A line in the terminal transcript. */
type TermLine =
  | { kind: "user" | "out"; text: string }
  | { kind: "tool"; text: string; tag: AuditTag }
  | { kind: "wrote"; text: string; node: LineageNode };

// Minimal markdown → HTML for chat bubbles. Escapes first (the only XSS guard
// on rendered lines), then applies bold + inline code.
function fmt(text: string) {
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function AssistantOverlay({
  context,
  onCreate,
  onClose,
  onOpenNode,
  go,
}: ChatDockProps) {
  // Re-render the recents list when backend sessions land (catalog commit).
  useCatalog();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
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

  async function runScript(promptText: string) {
    if (busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: promptText }]);
    const S = catalog.getChatScript();
    await sleep(450);
    setTyping(true);
    await sleep(700);
    setTyping(false);
    for (const turn of S.turns) {
      if (turn.type === "text") {
        setTyping(true);
        await sleep(520);
        setTyping(false);
        setMsgs((m) => [...m, { role: "bot", text: turn.text }]);
      } else {
        await sleep(360);
        setMsgs((m) => [...m, { role: "tool", say: turn.say, tag: turn.tag }]);
      }
    }
    onCreate(S.newNode, S.newEdge);
    setBusy(false);
  }

  const newSession = () => {
    if (busy) return;
    setMsgs([]);
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
        {context && (
          <span className={styles.chatCtx}>
            <LayerDot layer={context.layer} size={6} />
            {context.label}
          </span>
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
              {catalog.listRecents().map((r, i) => {
                const node = r.nodeId ? catalog.getNode(r.nodeId) : null;
                return (
                  <button
                    key={i}
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
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => runScript(s.t)}>
                  <Icon name={s.ic} size={16} />
                  {s.t}
                </button>
              ))}
            </div>
          </>
        )}
        {msgs.map((m, i) => {
          if (m.role === "tool")
            return (
              <div className={styles.toolCard} key={i}>
                <span className={styles.tcIco}>
                  <Icon name={TAG_ICON[m.tag]} />
                </span>
                <span>{m.say}</span>
                <span className={styles.tcTag}>{m.tag}</span>
              </div>
            );
          return (
            <div
              className={`${styles.msg} ${m.role === "user" ? styles.user : styles.bot}`}
              key={i}
            >
              <div
                className={styles.bubble}
                dangerouslySetInnerHTML={{ __html: fmt(m.text) }}
              />
            </div>
          );
        })}
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
        {msgs.some((m) => m.role === "tool") && !busy && (
          <button
            className="btn sq"
            style={{ alignSelf: "flex-start", fontSize: 13 }}
            onClick={() => onOpenNode(catalog.getChatScript().newNode)}
          >
            <Icon name="eye" size={14} />
            Open fct_revenue_by_region
          </button>
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
                runScript(input.trim());
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
              runScript(input.trim());
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

export function TerminalAssistant({
  context,
  onCreate,
  onClose,
  onOpenNode,
  go,
}: ChatDockProps) {
  // Re-render the recents list when backend sessions land (catalog commit).
  useCatalog();
  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(false);
  const [closing, setClosing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, cursor]);
  useEffect(() => {
    if (inRef.current) inRef.current.focus();
  }, []);
  const closeWith = (fn?: () => void) => {
    setClosing(true);
    setTimeout(() => {
      if (fn) fn();
      onClose();
    }, 200);
  };

  async function runScript(promptText: string) {
    if (busy) return;
    setBusy(true);
    setLines((l) => [...l, { kind: "user", text: promptText }]);
    const S = catalog.getChatScript();
    setCursor(true);
    await sleep(620);
    setCursor(false);
    for (const turn of S.turns) {
      if (turn.type === "text") {
        setCursor(true);
        await sleep(440);
        setCursor(false);
        setLines((l) => [...l, { kind: "out", text: turn.text }]);
      } else {
        await sleep(300);
        setLines((l) => [
          ...l,
          { kind: "tool", text: turn.say, tag: turn.tag },
        ]);
      }
    }
    onCreate(S.newNode, S.newEdge);
    setLines((l) => [
      ...l,
      {
        kind: "wrote",
        text: "models/marts/fct_revenue_by_region.sql",
        node: S.newNode,
      },
    ]);
    setBusy(false);
  }

  function submit() {
    const v = input.trim();
    if (!v || busy) return;
    if (v === "clear") {
      setLines([]);
      setInput("");
      return;
    }
    runScript(v);
    setInput("");
  }
  const newSession = () => {
    if (!busy) {
      setLines([]);
      setInput("");
    }
  };
  const where = context ? context.label : "pipeline";

  return (
    <div
      className={`${styles.termDock}${closing ? " " + styles.out : ""}`}
      onClick={() => inRef.current && inRef.current.focus()}
    >
      <div className={styles.termBar}>
        <div className={styles.termLights}>
          <i />
          <i />
          <i />
        </div>
        <span className={styles.termWhere}>
          assistant@duckdb <b>—</b>{" "}
          <span className={styles.termCtx}>{where}</span>
        </span>
        <div className={styles.termActs}>
          <button
            className={styles.termBtn}
            title="New session"
            onClick={newSession}
          >
            +
          </button>
          <button
            className={styles.termBtn}
            title="History"
            onClick={() => closeWith(() => go({ name: "chats" }))}
          >
            ⌁
          </button>
          <button
            className={styles.termBtn}
            title="Close"
            onClick={() => closeWith()}
          >
            ✕
          </button>
        </div>
      </div>
      <div className={styles.termBody} ref={bodyRef}>
        <div className={`${styles.tl} ${styles.tlBanner}`}>
          dashboard-chat <b>assistant</b> v1.0 · duckdb shell · type a request,
          or{" "}
          <span
            className={styles.tlLink}
            onClick={() => runScript(catalog.getChatScript().prompt)}
          >
            try a demo
          </span>
        </div>
        {lines.length === 0 && (
          <>
            <div className={`${styles.tl} ${styles.tlDim}`} style={{ marginTop: 6 }}>
              recent sessions —
            </div>
            {catalog.listRecents().map((r, i) => (
              <div
                className={`${styles.tl} ${styles.termRec}`}
                key={i}
                onClick={() =>
                  closeWith(() => go({ name: "openRecent", nodeId: r.nodeId }))
                }
              >
                <span className={styles.n}>[{i + 1}]</span> {r.title}
              </div>
            ))}
            <div
              className={`${styles.tl} ${styles.tlDim}`}
              style={{ margin: "6px 0 2px" }}
            >
              type a request below, or run a number above ↑
            </div>
          </>
        )}
        {lines.map((ln, i) => {
          if (ln.kind === "user")
            return (
              <div className={`${styles.tl} ${styles.tlUser}`} key={i}>
                <span className={styles.tp}>analyst</span>
                <span className={styles.tc}>@</span>
                <span className={styles.th}>demo</span>
                <span className={styles.tc}>:~$</span> {ln.text}
              </div>
            );
          if (ln.kind === "tool")
            return (
              <div className={`${styles.tl} ${styles.tlTool}`} key={i}>
                <span className={styles.ok}>[✓]</span>
                <span>{ln.text}</span>
                <span className={styles.tg}>{ln.tag}</span>
              </div>
            );
          if (ln.kind === "wrote")
            return (
              <div className={`${styles.tl} ${styles.tlTool}`} key={i}>
                <span className={styles.ok}>→</span>
                <span>
                  wrote{" "}
                  <span
                    className={styles.tlLink}
                    onClick={() => onOpenNode(ln.node)}
                  >
                    {ln.text}
                  </span>
                </span>
              </div>
            );
          return (
            <div
              className={`${styles.tl} ${styles.tlOut}`}
              key={i}
              dangerouslySetInnerHTML={{ __html: fmt(ln.text) }}
            />
          );
        })}
        {cursor && (
          <div className={`${styles.tl} ${styles.tlOut}`}>
            <span className={styles.tlDim}>…</span>{" "}
            <span className={styles.termCursor} />
          </div>
        )}
      </div>
      <div className={styles.termInputRow}>
        <span className={styles.termPrompt}>
          <span className={styles.tp}>analyst</span>
          <span className={styles.tc}>@</span>
          <span className={styles.th}>demo</span>
          <span className={styles.tc}>:~$</span>
        </span>
        <input
          ref={inRef}
          className={styles.termInput}
          value={input}
          placeholder={
            busy ? "running…" : "describe a transform, join or metric"
          }
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        {!busy && !input && <span className={styles.termCursor} />}
      </div>
    </div>
  );
}
