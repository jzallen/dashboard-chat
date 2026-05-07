/**
 * Unit tests for the v6 chat-stream pipe seam (`pipeChatStream`).
 *
 * This is the seam that handleChat composes to produce a v6
 * `createUIMessageStream({execute})` body. It owns:
 *   - draining `eventBuffer` ChatEvents into `data-chat-event` chunks at the
 *     same temporal positions the v4 transform did (before each upstream chunk).
 *   - intercepting `resolve_dataset` tool-input-available chunks and rewriting
 *     them into a `data-agent-request` chunk; the rest of upstream is dropped
 *     and turn_done + persistence are SKIPPED for the paused turn.
 *   - emitting `turn_done` as a `data-chat-event` after upstream drains
 *     (when no resolve_dataset interception fired) and invoking the
 *     ThreadEventPersister for DomainEvents in order.
 *
 * The seam consumes a `ReadableStream<UIMessageChunk>` (e.g.
 * `result.toUIMessageStream()`) and writes through a `UIMessageStreamWriter`
 * — exactly what `createUIMessageStream({execute: ({writer}) => ...})` provides.
 */

import type { UIMessageChunk, UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { ChatEvent } from "../../lib/chat/events";
import { pipeChatStream } from "../../lib/chat/pipeChatStream";
import type { ThreadEventPersister } from "../../lib/chat/threadPersister";

function streamFrom(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

interface RecordingWriter extends UIMessageStreamWriter {
  written: UIMessageChunk[];
}

function recordingWriter(): RecordingWriter {
  const written: UIMessageChunk[] = [];
  return {
    written,
    write(part) {
      written.push(part);
    },
    merge(_stream) {
      throw new Error("pipeChatStream must drain manually, not via writer.merge()");
    },
    onError: undefined,
  };
}

function recordingPersister(): ThreadEventPersister & {
  calls: Array<{ channelId: string; events: ChatEvent[] }>;
} {
  const calls: Array<{ channelId: string; events: ChatEvent[] }> = [];
  return {
    calls,
    async persist(channelId, events) {
      calls.push({ channelId, events: [...events] });
    },
  };
}

describe("pipeChatStream — v6 emit seam", () => {
  it("flushes buffered ChatEvents BEFORE the next upstream chunk (causal order)", async () => {
    // Given: upstream streams two text deltas with a finish in between, and a
    // dispatcher pushed a transform_applied event into the buffer between them.
    const buffer: ChatEvent[] = [];
    const upstream = streamFrom([
      { type: "text-start", id: "m1" },
      { type: "text-delta", id: "m1", delta: "hello" },
      // The agent dispatcher would push this onto the buffer between chunks
      // arriving — simulate by pushing now (before the next pull).
      { type: "text-delta", id: "m1", delta: " world" },
      { type: "text-end", id: "m1" },
      { type: "finish", finishReason: "stop" },
    ]);
    // Dispatcher pushes between deltas. We schedule the push at the moment the
    // first delta is consumed by the seam (the seam yields synchronously), so
    // we use a simple injection: push BEFORE running the seam, but wrap with a
    // fixture that flushes only one event per chunk boundary.
    // Simpler: push it once at start; the seam should drain at every step,
    // and since text-delta('hello') happens first, the data-chat-event lands
    // BEFORE the SECOND text-delta(' world'). We don't want it BEFORE 'hello'
    // because the dispatcher hadn't fired yet — so we push AFTER 'hello'.

    // Simulate the temporal push: control via an upstream that emits a side
    // effect after 'hello' is read. We rebuild it.
    let pushed = false;
    const upstream2 = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "m1" });
        controller.enqueue({ type: "text-delta", id: "m1", delta: "hello" });
      },
      pull(controller) {
        if (!pushed) {
          // dispatcher would have run here:
          buffer.push({
            type: "transform_applied",
            transform_id: "t-1",
            dataset_id: "ds-1",
            operation: "trim",
            column: "region",
          });
          pushed = true;
          controller.enqueue({ type: "text-delta", id: "m1", delta: " world" });
          controller.enqueue({ type: "text-end", id: "m1" });
          controller.enqueue({ type: "finish", finishReason: "stop" });
          controller.close();
        }
      },
    });
    const writer = recordingWriter();
    const persister = recordingPersister();

    await pipeChatStream({
      upstream: upstream2,
      writer,
      eventBuffer: buffer,
      channelId: "ch-1",
      persister,
    });

    // Then: the data-chat-event for transform_applied appears BEFORE the
    // text-delta(' world') chunk it preceded onto the wire — preserving the
    // causal order semantics the v4 transform had. (Whether it lands before
    // OR after text-delta('hello') depends on stream pull() timing relative
    // to the dispatcher push; the contract that matters is "BEFORE the next
    // chunk that the dispatcher's tool produced".)
    const types = writer.written.map((c) => c.type);
    const idxDataEvent = types.indexOf("data-chat-event");
    const idxSecondDelta = types.lastIndexOf("text-delta");
    expect(idxDataEvent).toBeGreaterThanOrEqual(0);
    expect(idxSecondDelta).toBeGreaterThan(idxDataEvent);

    // And the data-chat-event payload IS the transform_applied event.
    const dataChatEvents = writer.written.filter(
      (c): c is Extract<UIMessageChunk, { type: `data-${string}` }> =>
        typeof c.type === "string" && c.type === "data-chat-event",
    );
    expect(dataChatEvents).toHaveLength(2); // transform_applied + turn_done
    expect((dataChatEvents[0] as { data: ChatEvent }).data).toMatchObject({
      type: "transform_applied",
      column: "region",
      operation: "trim",
    });

    // And turn_done is emitted as the LAST data-chat-event after upstream drains.
    expect((dataChatEvents[1] as { data: ChatEvent }).data).toEqual({
      type: "turn_done",
      reason: "stop",
    });

    // And persistence was called once with the DomainEvents in order.
    expect(persister.calls).toHaveLength(1);
    expect(persister.calls[0].channelId).toBe("ch-1");
    expect(persister.calls[0].events.map((e) => e.type)).toEqual([
      "transform_applied",
      "turn_done",
    ]);
  });

  it("intercepts resolve_dataset tool-input-available, emits data-agent-request, and skips turn_done + persistence", async () => {
    const buffer: ChatEvent[] = [];
    const upstream = streamFrom([
      { type: "text-start", id: "m1" },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "resolve_dataset",
        input: { name: "patients" },
      },
      // Anything after this should be ignored — we paused the turn.
      { type: "text-delta", id: "m1", delta: "should-not-emit" },
      { type: "finish", finishReason: "stop" },
    ]);
    const writer = recordingWriter();
    const persister = recordingPersister();

    await pipeChatStream({
      upstream,
      writer,
      eventBuffer: buffer,
      channelId: "ch-1",
      persister,
    });

    // data-agent-request part is emitted in place of the tool-input-available
    const requestParts = writer.written.filter((c) => c.type === "data-agent-request");
    expect(requestParts).toHaveLength(1);
    expect((requestParts[0] as { data: unknown }).data).toEqual({
      type: "resolve_dataset",
      params: { name: "patients" },
    });

    // No turn_done was emitted (paused-turn skip)
    const dataChatEvents = writer.written.filter((c) => c.type === "data-chat-event");
    const turnDones = dataChatEvents.filter(
      (c) => (c as { data: ChatEvent }).data.type === "turn_done",
    );
    expect(turnDones).toHaveLength(0);

    // No raw tool-* parts leak through (the contract from the walking skeleton)
    const toolParts = writer.written.filter(
      (c) => typeof c.type === "string" && c.type.startsWith("tool-"),
    );
    expect(toolParts).toHaveLength(0);

    // No upstream chunks after the intercept reach the writer either.
    const textDeltas = writer.written.filter((c) => c.type === "text-delta");
    expect(textDeltas).toHaveLength(0);

    // Persistence was NOT invoked (paused turn isn't a checkpoint).
    expect(persister.calls).toHaveLength(0);
  });

  it("excludes UI directives from persistence but still emits them on the stream", async () => {
    // ADR-014: only DomainEvents persist; UI directives are ephemeral.
    const buffer: ChatEvent[] = [];
    const upstream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        // Push a directive + a domain event onto the buffer before chunks land.
        buffer.push({ type: "sort_directive", column: "region", direction: "asc" });
        buffer.push({ type: "row_added", dataset_id: "ds-1", row_id: "r-1" });
        controller.enqueue({ type: "text-delta", id: "m1", delta: "ok" });
        controller.enqueue({ type: "finish", finishReason: "stop" });
        controller.close();
      },
    });
    const writer = recordingWriter();
    const persister = recordingPersister();

    await pipeChatStream({
      upstream,
      writer,
      eventBuffer: buffer,
      channelId: "ch-1",
      persister,
    });

    // The stream carries BOTH the directive and the domain event as data-chat-event parts.
    const dataChatEvents = writer.written
      .filter((c) => c.type === "data-chat-event")
      .map((c) => (c as { data: ChatEvent }).data.type);
    expect(dataChatEvents).toEqual([
      "sort_directive",
      "row_added",
      "turn_done",
    ]);

    // But persistence excluded the UI directive.
    expect(persister.calls).toHaveLength(1);
    expect(persister.calls[0].events.map((e) => e.type)).toEqual([
      "row_added",
      "turn_done",
    ]);
  });

  it("emits turn_done on the stream even when persistence rejects (best-effort durability)", async () => {
    const buffer: ChatEvent[] = [
      { type: "row_added", dataset_id: "ds-1", row_id: "r-1" },
    ];
    const upstream = streamFrom([{ type: "finish", finishReason: "stop" }]);
    const writer = recordingWriter();
    const failing: ThreadEventPersister = {
      persist: vi.fn().mockRejectedValue(new Error("Stream.io is down")),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await pipeChatStream({
        upstream,
        writer,
        eventBuffer: buffer,
        channelId: "ch-1",
        persister: failing,
      });

      const turnDoneEvents = writer.written.filter(
        (c) =>
          c.type === "data-chat-event" &&
          (c as { data: ChatEvent }).data.type === "turn_done",
      );
      expect(turnDoneEvents).toHaveLength(1);
      expect(failing.persist).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skips persistence when channelId is empty but still emits turn_done", async () => {
    const buffer: ChatEvent[] = [
      { type: "row_added", dataset_id: "ds-1", row_id: "r-1" },
    ];
    const upstream = streamFrom([{ type: "finish", finishReason: "stop" }]);
    const writer = recordingWriter();
    const persister = recordingPersister();

    await pipeChatStream({
      upstream,
      writer,
      eventBuffer: buffer,
      channelId: "",
      persister,
    });

    expect(persister.calls).toHaveLength(0);
    const turnDones = writer.written.filter(
      (c) =>
        c.type === "data-chat-event" &&
        (c as { data: ChatEvent }).data.type === "turn_done",
    );
    expect(turnDones).toHaveLength(1);
  });

  it("maps upstream finishReason onto the turn_done reason", async () => {
    const cases: Array<{
      finishReason: "stop" | "length" | "tool-calls" | "error" | "content-filter" | "other";
      reason: "stop" | "length" | "error";
    }> = [
      { finishReason: "stop", reason: "stop" },
      { finishReason: "length", reason: "length" },
      { finishReason: "tool-calls", reason: "stop" },
      { finishReason: "error", reason: "error" },
    ];

    for (const { finishReason, reason } of cases) {
      const buffer: ChatEvent[] = [];
      const upstream = streamFrom([{ type: "finish", finishReason }]);
      const writer = recordingWriter();
      const persister = recordingPersister();

      await pipeChatStream({
        upstream,
        writer,
        eventBuffer: buffer,
        channelId: "ch-1",
        persister,
      });

      const turnDone = writer.written.find(
        (c) =>
          c.type === "data-chat-event" &&
          (c as { data: ChatEvent }).data.type === "turn_done",
      );
      expect((turnDone as { data: ChatEvent }).data).toEqual({
        type: "turn_done",
        reason,
      });
    }
  });
});
