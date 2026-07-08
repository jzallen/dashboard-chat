/**
 * The live assistant turn as a cancellable hook. `send(prompt)` POSTs the
 * message to the ui/ server broker (`/ui-server/chat`), which relays the agent
 * SSE straight back, and streams the assistant's reply into `msgs`. A
 * dataset-mutating domain event (transform_applied, column_renamed, row_*)
 * triggers one framework revalidation per turn — via the injected `revalidate`
 * (the caller's useRevalidator) — so the lineage reflects the change.
 *
 * Cancellation is the point of the hook: each turn runs under an AbortController
 * whose signal is handed to fetch and aborted on unmount, and a mounted ref gates
 * the streaming callbacks so a turn that outlives the component never writes state
 * into — or revalidates against — a torn-down tree.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { LineageNode } from "../../catalog";
import {
  type ChatStreamEvent,
  isCatalogMutatingEvent,
  readChatStream,
} from "../../lib/chat-stream";
import { catalog } from "../useCatalog";

/** A message in a chat transcript: prose bubbles from the user or the assistant.
 *  `id` is stamped at insertion so lists key by identity, not array position (the
 *  streaming bot bubble keeps its id as later deltas replace its text). */
export type TurnMessage = { id: string; role: "user" | "bot"; text: string };

let messageSeq = 0;
const nextMessageId = () => `m${++messageSeq}`;

/** Best-effort agent context from the open lineage node — the agent reads
 *  contextType/contextId to scope its tools.
 *
 *  ModelRef is heterogeneous and the backend vets it so exactly one shape key is
 *  populated: datasets carry `fields`, views `columns`, reports
 *  `columns_metadata`. The probe order below encodes that mutual exclusivity; it
 *  is not a fallback chain. */
export function agentContext(node: LineageNode | null): {
  contextType: "dataset" | "view" | "report" | null;
  contextId: string | null;
} {
  if (!node) return { contextType: null, contextId: null };
  const ref = node.ref;
  const contextType = ref?.fields
    ? "dataset"
    : ref?.columns
      ? "view"
      : ref?.columns_metadata
        ? "report"
        : null;
  return { contextType, contextId: node.id };
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
  const [msgs, setMsgs] = useState<TurnMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);

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
      setBusy(true);
      setMsgs((m) => [
        ...m,
        { id: nextMessageId(), role: "user", text: promptText },
      ]);
      setTyping(true);

      const controller = new AbortController();
      abort.current = controller;
      const { contextType, contextId } = agentContext(context);
      const projectId = catalog.getCurrentProject()?.id ?? null;
      const fired = { done: false };
      const botId = nextMessageId();
      let started = false;

      // isMounted flips to false in the unmount cleanup; ifMounted(fn) runs fn
      // only while mounted, so a frame arriving after the dock closes can't
      // setState/revalidate a torn-down tree.
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

        await readChatStream(res.body, {
          onText: ifMounted((accumulated) => {
            setTyping(false);
            const isFirst = !started;
            started = true;
            setMsgs((m) =>
              isFirst
                ? [...m, { id: botId, role: "bot", text: accumulated }]
                : [
                    ...m.slice(0, -1),
                    { id: botId, role: "bot", text: accumulated },
                  ],
            );
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
        if (isMounted.current) {
          setTyping(false);
          setBusy(false);
        }
      }
    },
    [busy, context, revalidate],
  );

  const reset = useCallback(() => {
    if (!busy) setMsgs([]);
  }, [busy]);

  return { msgs, typing, busy, send, reset };
}
