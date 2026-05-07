import type { UIMessageChunk, UIMessageStreamWriter } from "ai";

import type { ChatEvent } from "./events";
import { isDomainEvent, type ThreadEventPersister } from "./threadPersister";
import type { AgentRequest } from "./types";

/**
 * Maps an upstream AI SDK v6 finish reason onto the `turn_done` reason
 * vocabulary the FE/persistence layer consumes. The v4 mapping (see the
 * pre-migration `mapFinishReason`) is preserved verbatim — `tool-calls` and
 * `content-filter` and `other` all collapse to `"stop"`. The `request` value
 * is no longer produced by the upstream itself in v6 (resolve_dataset
 * interception is signalled via a `data-agent-request` typed part instead),
 * but the union member is kept for compatibility with the `TurnDoneSchema`
 * (which still allows `"request"`).
 */
const TURN_DONE_REASON_BY_FINISH_REASON: Record<string, "stop" | "length" | "request" | "error"> = {
  stop: "stop",
  "tool-calls": "stop",
  length: "length",
  "content-filter": "stop",
  request: "request",
  error: "error",
  other: "stop",
};

function mapFinishReason(raw: string | undefined): "stop" | "length" | "request" | "error" {
  if (!raw) return "stop";
  return TURN_DONE_REASON_BY_FINISH_REASON[raw] ?? "stop";
}

/**
 * Build a `data-chat-event` chunk carrying a single ChatEvent payload. Wrapped
 * here so the literal string `"data-chat-event"` lives in exactly one place
 * (matched by the FE parser and by the walking-skeleton acceptance contract).
 */
function dataChatEventChunk(event: ChatEvent, id: string): UIMessageChunk {
  return {
    type: "data-chat-event",
    id,
    data: event,
  } as UIMessageChunk;
}

function dataAgentRequestChunk(request: AgentRequest, id: string): UIMessageChunk {
  return {
    type: "data-agent-request",
    id,
    data: request,
  } as UIMessageChunk;
}

interface PipeChatStreamArgs {
  /** UIMessageChunk stream from `result.toUIMessageStream(...)`. */
  upstream: ReadableStream<UIMessageChunk>;
  /** Writer provided by `createUIMessageStream({ execute: ({writer}) => ... })`. */
  writer: UIMessageStreamWriter;
  /** Mutable buffer that dispatcher `emit()` callbacks push ChatEvents into. */
  eventBuffer: ChatEvent[];
  /** Stream.io channel/thread id; empty string disables persistence. */
  channelId: string;
  /** Persistence port (best-effort). */
  persister: ThreadEventPersister;
}

/**
 * Drives an AI SDK v6 chat-stream pipe end-to-end inside a
 * `createUIMessageStream({execute})` callback.
 *
 * Invariants (see `agent/test/chat/pipeChatStream.test.ts`):
 *   1. Causal order: any ChatEvents pushed onto `eventBuffer` by dispatcher
 *      `execute()` callbacks are flushed as `data-chat-event` chunks BEFORE
 *      the next upstream chunk is forwarded.
 *   2. resolve_dataset interception: when `tool-input-available` arrives for
 *      the `resolve_dataset` tool, the seam emits a single `data-agent-request`
 *      typed part and stops draining upstream. `turn_done` is NOT emitted and
 *      persistence is NOT invoked (paused-turn semantics).
 *   3. Natural finish: when upstream drains without an interception, `turn_done`
 *      is pushed onto the buffer with the mapped finish reason, persistence is
 *      invoked once with the DomainEvents (UI directives excluded per
 *      ADR-014), and the final flush emits remaining buffered ChatEvents on
 *      the stream.
 *   4. Persistence is best-effort — a rejecting persister logs the error but
 *      does NOT block `turn_done` emission (dc-x3y.3.1 exit criterion 6).
 */
export async function pipeChatStream(args: PipeChatStreamArgs): Promise<void> {
  const { upstream, writer, eventBuffer, channelId, persister } = args;

  // Track every ChatEvent that flows through, so persistence sees the full
  // turn history (the v4 wrapper kept `splice` for the end-of-stream flush;
  // we drain mid-stream into chunks so we mirror it here).
  const allEvents: ChatEvent[] = [];

  const flushBuffer = (): void => {
    if (eventBuffer.length === 0) return;
    const drained = eventBuffer.splice(0, eventBuffer.length);
    let counter = 0;
    for (const event of drained) {
      allEvents.push(event);
      writer.write(dataChatEventChunk(event, `evt-${Date.now()}-${counter++}`));
    }
  };

  const reader = upstream.getReader();
  let finishReasonRaw: string | undefined;
  let intercepted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      // Intercept resolve_dataset BEFORE flushing/forwarding so we don't leak
      // the raw tool-input-available part to the FE (the walking-skeleton
      // contract: no raw tool-* parts surface).
      if (
        value.type === "tool-input-available" &&
        (value as { toolName?: string }).toolName === "resolve_dataset"
      ) {
        const input = (value as { input?: Record<string, unknown> }).input ?? {};
        // Flush whatever ChatEvents the dispatcher already pushed (e.g. an
        // error_occurred that surfaced before the resolve tool fired).
        flushBuffer();
        writer.write(
          dataAgentRequestChunk(
            { type: "resolve_dataset", params: input },
            `req-${Date.now()}`,
          ),
        );
        intercepted = true;
        break;
      }

      // Capture the upstream finish reason for the turn_done mapping.
      if (value.type === "finish") {
        finishReasonRaw = (value as { finishReason?: string }).finishReason;
        // Drop the upstream finish chunk — handleChat owns turn_done emission
        // through data-chat-event so the FE has a single ChatEvent oracle.
        // (The createUIMessageStream pipeline still emits its own outer
        // finish/start frames around `execute`.)
        flushBuffer();
        continue;
      }

      // Drop other tool-* parts so the FE never sees raw Groq tool deltas.
      // Dispatchers translate them into typed ChatEvents on the buffer.
      if (typeof value.type === "string" && value.type.startsWith("tool-")) {
        flushBuffer();
        continue;
      }

      // Causal-order flush: any ChatEvent pushed by a dispatcher between the
      // previous chunk and this one lands on the wire BEFORE this chunk.
      flushBuffer();
      writer.write(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (intercepted) return;

  // Natural finish: emit turn_done + persist domain events.
  const reason = mapFinishReason(finishReasonRaw);
  eventBuffer.push({ type: "turn_done", reason });

  // Collect the full turn history (mid-stream drains + the trailing turn_done
  // and any other tail events) for persistence — UI directives are excluded
  // per ADR-014.
  const tailEvents = [...eventBuffer];
  const domainEvents = [...allEvents, ...tailEvents].filter(isDomainEvent);
  if (channelId && domainEvents.length > 0) {
    try {
      await persister.persist(channelId, domainEvents);
    } catch (err) {
      console.error("[agent] thread persistence failed:", err);
    }
  }

  flushBuffer();
}
