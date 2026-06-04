/* Chat dock (scripted creation): the assistant overlay and its terminal variant. */
import { useEffect, useRef, useState } from "react";

import type { Edge, LineageNode } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { Icon, type IconName, LayerDot } from "../primitives";
import { TAG_ICON } from "../tagIcon";

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
  | { role: "tool"; say: string; tag: string };

/** A line in the terminal transcript. */
type TermLine =
  | { kind: "user" | "out"; text: string }
  | { kind: "tool"; text: string; tag: string }
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
    <div className={"assistant-overlay" + (closing ? " ao-out" : "")}>
      <div className="ao-head">
        <span className="ao-mark">
          <Icon name="sparkle" size={15} />
        </span>
        <span className="ct">Assistant</span>
        {context && (
          <span className="chat-ctx">
            <LayerDot layer={context.layer} size={6} />
            {context.label}
          </span>
        )}
        <div className="ao-actions">
          <button className="ao-iconbtn" onClick={newSession}>
            <Icon name="plus" size={16} />
            <span className="tip">New session</span>
          </button>
          <button
            className="ao-iconbtn"
            onClick={() => closeWith(() => go({ name: "chats" }))}
          >
            <Icon name="clock" size={16} />
            <span className="tip">History &amp; search</span>
          </button>
          <button className="ao-iconbtn" onClick={() => closeWith()}>
            <Icon name="x" size={16} />
            <span className="tip">Close</span>
          </button>
        </div>
      </div>
      <div className="ao-body" ref={bodyRef}>
        {msgs.length === 0 && (
          <>
            <div className="ao-section">
              <span className="ao-sec-label">Recent</span>
            </div>
            <div className="ao-recents">
              {catalog.listRecents().map((r, i) => {
                const node = r.nodeId ? catalog.getNode(r.nodeId) : null;
                return (
                  <button
                    key={i}
                    className={
                      "ao-recent" + (node ? " layer-" + node.layer : "")
                    }
                    onClick={() => go({ name: "openRecent", nodeId: r.nodeId })}
                  >
                    <span className="ao-rec-dot">
                      {node ? (
                        <LayerDot layer={node.layer} size={7} />
                      ) : (
                        <Icon name="chat" size={13} />
                      )}
                    </span>
                    <span className="ao-rec-title">{r.title}</span>
                    <Icon
                      name="arrow"
                      size={14}
                      style={{ color: "var(--text-400)", flex: "0 0 auto" }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="ao-divider">
              <span>or start something new</span>
            </div>
            <div className="suggest">
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
              <div className="tool-card" key={i}>
                <span className="tc-ico">
                  <Icon name={TAG_ICON[m.tag] || "check"} />
                </span>
                <span>{m.say}</span>
                <span className="tc-tag">{m.tag}</span>
              </div>
            );
          return (
            <div
              className={"msg " + (m.role === "user" ? "user" : "bot")}
              key={i}
            >
              <div
                className="bubble"
                dangerouslySetInnerHTML={{ __html: fmt(m.text) }}
              />
            </div>
          );
        })}
        {typing && (
          <div className="msg bot">
            <div className="bubble" style={{ padding: 0 }}>
              <div className="typing">
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
      <div className="ao-input">
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
          className="send-btn"
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
      className={"term-dock" + (closing ? " out" : "")}
      onClick={() => inRef.current && inRef.current.focus()}
    >
      <div className="term-bar">
        <div className="term-lights">
          <i />
          <i />
          <i />
        </div>
        <span className="term-where">
          assistant@duckdb <b>—</b> <span className="term-ctx">{where}</span>
        </span>
        <div className="term-acts">
          <button className="term-btn" title="New session" onClick={newSession}>
            +
          </button>
          <button
            className="term-btn"
            title="History"
            onClick={() => closeWith(() => go({ name: "chats" }))}
          >
            ⌁
          </button>
          <button
            className="term-btn"
            title="Close"
            onClick={() => closeWith()}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="term-body" ref={bodyRef}>
        <div className="tl tl-banner">
          dashboard-chat <b>assistant</b> v1.0 · duckdb shell · type a request,
          or{" "}
          <span
            className="tl-link"
            onClick={() => runScript(catalog.getChatScript().prompt)}
          >
            try a demo
          </span>
        </div>
        {lines.length === 0 && (
          <>
            <div className="tl tl-dim" style={{ marginTop: 6 }}>
              recent sessions —
            </div>
            {catalog.listRecents().map((r, i) => (
              <div
                className="tl term-rec"
                key={i}
                onClick={() =>
                  closeWith(() => go({ name: "openRecent", nodeId: r.nodeId }))
                }
              >
                <span className="n">[{i + 1}]</span> {r.title}
              </div>
            ))}
            <div className="tl tl-dim" style={{ margin: "6px 0 2px" }}>
              type a request below, or run a number above ↑
            </div>
          </>
        )}
        {lines.map((ln, i) => {
          if (ln.kind === "user")
            return (
              <div className="tl tl-user" key={i}>
                <span className="tp">analyst</span>
                <span className="tc">@</span>
                <span className="th">demo</span>
                <span className="tc">:~$</span> {ln.text}
              </div>
            );
          if (ln.kind === "tool")
            return (
              <div className="tl tl-tool" key={i}>
                <span className="ok">[✓]</span>
                <span>{ln.text}</span>
                <span className="tg">{ln.tag}</span>
              </div>
            );
          if (ln.kind === "wrote")
            return (
              <div className="tl tl-tool" key={i}>
                <span className="ok">→</span>
                <span>
                  wrote{" "}
                  <span className="tl-link" onClick={() => onOpenNode(ln.node)}>
                    {ln.text}
                  </span>
                </span>
              </div>
            );
          return (
            <div
              className="tl tl-out"
              key={i}
              dangerouslySetInnerHTML={{ __html: fmt(ln.text) }}
            />
          );
        })}
        {cursor && (
          <div className="tl tl-out">
            <span className="tl-dim">…</span> <span className="term-cursor" />
          </div>
        )}
      </div>
      <div className="term-input-row">
        <span className="term-prompt">
          <span className="tp">analyst</span>
          <span className="tc">@</span>
          <span className="th">demo</span>
          <span className="tc">:~$</span>
        </span>
        <input
          ref={inRef}
          className="term-input"
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
        {!busy && !input && <span className="term-cursor" />}
      </div>
    </div>
  );
}
