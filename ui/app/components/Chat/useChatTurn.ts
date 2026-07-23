/**
 * useChatTurn — owns the state of a single assistant chat conversation: the
 * transcript (`msgs`) plus the `typing`/`busy` status flags.
 *
 * A "turn" is one round trip with the assistant: the user sends a prompt, the
 * assistant streams a reply back token-by-token into one bot bubble, and — if
 * that reply mutated the dataset — the lineage is revalidated once. `send()`
 * runs that round trip against the ui/ server broker (`/ui-server/chat`, which
 * relays the agent's SSE straight back); `reset()` clears the transcript to
 * start a fresh session.
 *
 * THE HAZARD this hook exists to handle: the SSE turn is asynchronous and
 * long-lived (a reply can stream for many seconds), but the dock that renders it
 * can be closed by the user mid-stream. Any frame that arrives after that close
 * must NOT touch React — the component is gone, so a `setState` or a revalidate
 * would either warn or act on a torn-down tree. Two guards, set up together in
 * `send`, drop those late frames:
 *   - an `AbortController`, aborted in the unmount cleanup, cancels the fetch;
 *   - an `isMounted` ref gates every deferred stream callback (see `ifMounted`),
 *     covering the microtask race where a frame is already in flight when the
 *     abort lands.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { LineageNode, ModelKind } from "../../catalog";
import { modelKindForLayer } from "../../catalog";
import {
  type ChatStreamEvent,
  isCatalogMutatingEvent,
  readChatStream,
} from "../../lib/chat-stream";
import { useCatalogFromContext } from "../useCatalog";

/** A message in a chat transcript: prose bubbles from the user or the assistant.
 *  `id` is stamped at insertion so lists key by identity, not array position (the
 *  streaming bot bubble keeps its id as later deltas replace its text). */
export type TurnMessage = { id: string; role: "user" | "bot"; text: string };

let messageSeq = 0;
const nextMessageId = () => `m${++messageSeq}`;

/** Fold a streamed text-delta into this turn's single bot bubble: create it on
 *  the first delta, replace its text on every delta after. Keyed by the turn's
 *  `botId` so the growing reply stays one bubble rather than appending a new one
 *  per token. A pure `msgs → msgs` transition so `send` reads as intent. */
function streamedInto(
  msgs: TurnMessage[],
  botId: string,
  text: string,
): TurnMessage[] {
  const bubble: TurnMessage = { id: botId, role: "bot", text };
  const last = msgs[msgs.length - 1];
  return last?.id === botId
    ? [...msgs.slice(0, -1), bubble]
    : [...msgs, bubble];
}

/** Best-effort agent context from the open lineage node — the agent reads
 *  contextType/contextId to scope its tools. contextType derives from the
 *  node's pipeline layer (the domain 1:1), not the loose ModelRef bag. */
export function agentContext(node: LineageNode | null): {
  contextType: ModelKind | null;
  contextId: string | null;
} {
  if (!node) return { contextType: null, contextId: null };
  return {
    contextType: modelKindForLayer(node.layer) ?? null,
    contextId: node.id,
  };
}

/** Fire the framework revalidation on the first dataset-mutating event of a turn;
 *  text/turn/error events and UI directives do not mutate the dataset. */
function revalidateOnMutation(
  event: ChatStreamEvent,
  fired: { done: boolean },
  revalidate: () => void,
) {
  if (!fired.done && isCatalogMutatingEvent(event)) {
    fired.done = true;
    revalidate();
  }
}

export interface ChatTurn {
  msgs: TurnMessage[];
  typing: boolean;
  busy: boolean;
  send: (promptText: string) => Promise<void>;
  reset: () => void;
}

export function useChatTurn(
  context: LineageNode | null,
  revalidate: () => void,
): ChatTurn {
  const catalog = useCatalogFromContext();
  const [msgs, setMsgs] = useState<TurnMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);

  // Tracks whether the dock is still mounted; the unmount cleanup flips it false
  // and aborts any in-flight turn. See the module docstring (THE HAZARD).
  const isMounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const send = useCallback(
    async (promptText: string) => {
      if (busy) return;

      // Phase 1 — optimistically show the prompt and the typing indicator.
      setBusy(true);
      setTyping(true);
      setMsgs((m) => [
        ...m,
        { id: nextMessageId(), role: "user", text: promptText },
      ]);

      // Phase 2 — set up the cancellable turn: a fresh controller (aborted on
      // unmount), the id the streamed reply will accrue into, and a once-latch
      // for the per-turn revalidation.
      const controller = new AbortController();
      abort.current = controller;
      const botId = nextMessageId();
      const fired = { done: false };
      const { contextType, contextId } = agentContext(context);
      const projectId = catalog.getCurrentProject()?.id ?? null;

      // Runs a stream callback only while still mounted, so a frame that lands
      // after the dock closes can't setState/revalidate a torn-down tree.
      const ifMounted =
        <A extends unknown[]>(fn: (...a: A) => void) =>
        (...a: A) => {
          if (isMounted.current) fn(...a);
        };

      try {
        const res = await fetch("/ui-server/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: promptText }],
            contextType,
            contextId,
            project_id: projectId,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);

        // Phase 3 — stream the reply into the bot bubble; revalidate once on the
        // first dataset-mutating event; surface a stream-level error inline.
        await readChatStream(res.body, {
          onText: ifMounted((accumulated) => {
            setTyping(false);
            setMsgs((m) => streamedInto(m, botId, accumulated));
          }),
          onEvent: ifMounted((event) =>
            revalidateOnMutation(event, fired, revalidate),
          ),
          onError: ifMounted((message) => {
            setTyping(false);
            setMsgs((m) => [
              ...m,
              { id: nextMessageId(), role: "bot", text: `⚠️ ${message}` },
            ]);
          }),
        });
      } catch (err) {
        // An abort is the expected unmount path — nothing to show. Any other
        // failure (broker down, non-2xx) surfaces as an unavailable notice.
        if ((err as Error)?.name === "AbortError") return;
        if (!isMounted.current) return;
        setTyping(false);
        setMsgs((m) => [
          ...m,
          {
            id: nextMessageId(),
            role: "bot",
            text: "⚠️ The assistant is unavailable right now.",
          },
        ]);
      } finally {
        // Phase 4 — clear the status flags, but only if the dock is still here.
        if (isMounted.current) {
          setTyping(false);
          setBusy(false);
        }
      }
    },
    [busy, catalog, context, revalidate],
  );

  const reset = useCallback(() => {
    if (!busy) setMsgs([]);
  }, [busy]);

  return { msgs, typing, busy, send, reset };
}
