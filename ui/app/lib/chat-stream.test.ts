// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  type ChatStreamEvent,
  isCatalogMutatingEvent,
  readChatStream,
} from "./chat-stream";

function frame(o: unknown): string {
  return `data: ${JSON.stringify(o)}\n\n`;
}

/** A ReadableStream of the given chunks (each chunk encoded as one Uint8Array),
 *  so frame boundaries can be split across reads. */
function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("readChatStream — client-side agent SSE reader", () => {
  it("accumulates text deltas and emits domain events, then finishes once", async () => {
    const events: ChatStreamEvent[] = [];
    const texts: string[] = [];
    let doneText: string | null = null;

    await readChatStream(
      stream(
        frame({ type: "text-delta", id: "t", delta: "Trimmed " }),
        frame({ type: "text-delta", id: "t", delta: "whitespace." }),
        frame({
          type: "data-chat-event",
          id: "e",
          data: {
            type: "transform_applied",
            transform_id: "tr-1",
            dataset_id: "ds-1",
            operation: "trim",
            column: "city",
          },
        }),
        frame({ type: "finish", finishReason: "stop" }),
        "data: [DONE]\n\n",
      ),
      {
        onText: (acc) => texts.push(acc),
        onEvent: (e) => events.push(e),
        onDone: (acc) => {
          doneText = acc;
        },
      },
    );

    expect(texts).toEqual(["Trimmed ", "Trimmed whitespace."]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("transform_applied");
    expect((events[0] as { column: string }).column).toBe("city");
    expect(doneText).toBe("Trimmed whitespace.");
  });

  it("reassembles frames split across chunk boundaries", async () => {
    const texts: string[] = [];
    const f = frame({ type: "text-delta", id: "t", delta: "hello" });
    const mid = Math.floor(f.length / 2);

    await readChatStream(stream(f.slice(0, mid), f.slice(mid)), {
      onText: (acc) => texts.push(acc),
    });

    expect(texts).toEqual(["hello"]);
  });

  it("surfaces error frames via onError", async () => {
    let err: string | null = null;
    await readChatStream(
      stream(frame({ type: "error", errorText: "groq exploded" })),
      { onText: () => {}, onError: (m) => (err = m) },
    );
    expect(err).toBe("groq exploded");
  });

  it("classifies only dataset-mutating domain events for revalidation", () => {
    const mut = (type: string) => isCatalogMutatingEvent({ type });
    expect(mut("transform_applied")).toBe(true);
    expect(mut("column_renamed")).toBe(true);
    expect(mut("row_added")).toBe(true);
    expect(mut("row_deleted")).toBe(true);
    expect(mut("transform_undone")).toBe(true);
    expect(mut("transform_re_enabled")).toBe(true);
    // Non-mutating: text/turn/error + UI directives stay client-only.
    expect(mut("assistant_text_delta")).toBe(false);
    expect(mut("turn_done")).toBe(false);
    expect(mut("error_occurred")).toBe(false);
    expect(mut("sort_directive")).toBe(false);
  });
});
