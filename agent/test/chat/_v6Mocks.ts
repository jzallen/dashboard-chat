/**
 * Shared v6 mock helpers for the agent chat unit suite.
 *
 * Replaces the v4 data-stream-response mock surface. Production code
 * (`handleChat.ts`) consumes `result.toUIMessageStream()` — a
 * `ReadableStream<UIMessageChunk>` — and runs it through `pipeChatStream` inside
 * a `createUIMessageStream({execute})` callback. These helpers let unit tests
 * synthesize that upstream chunk sequence and parse the resulting v6 SSE body.
 *
 * Usage in a test file:
 *
 *   import { mockStreamTextResult, parseSseFrames } from "./_v6Mocks";
 *   vi.mock("ai", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("ai")>();
 *     return {
 *       ...actual,                         // keep createUIMessageStream(...) real
 *       streamText: vi.fn(() => mockStreamTextResult([
 *         { type: "text-delta", id: "m1", delta: "hello" },
 *         { type: "finish", finishReason: "stop" },
 *       ])),
 *       tool: vi.fn((opts: unknown) => opts),
 *     };
 *   });
 */

import type { UIMessageChunk } from "ai";

export interface MockStreamTextResult {
  toUIMessageStream: () => ReadableStream<UIMessageChunk>;
}

/**
 * Build the object shape that `streamText()` returns in v6 — only the
 * `toUIMessageStream` method is consumed by `handleChat`. Each call to
 * `toUIMessageStream` returns a fresh ReadableStream from the same chunk array.
 */
export function mockStreamTextResult(chunks: UIMessageChunk[]): MockStreamTextResult {
  return {
    toUIMessageStream: () =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
  };
}

/**
 * Parse a v6 UIMessage SSE response body into individual `UIMessageChunk`
 * payloads. Frames are separated by blank lines (`\n\n`); each frame has shape
 * `data: <json>\n` with a `data: [DONE]` sentinel terminator that we drop.
 */
export interface UIMessageFrame {
  type: string;
  id?: string;
  data?: unknown;
  delta?: unknown;
  finishReason?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

export async function parseSseFrames(response: Response): Promise<UIMessageFrame[]> {
  const text = await response.text();
  const frames = text.split("\n\n");
  const out: UIMessageFrame[] = [];
  for (const frame of frames) {
    const trimmed = frame.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("data:")) continue;
    const payloadText = trimmed.slice("data:".length).trim();
    if (!payloadText) continue;
    if (payloadText === "[DONE]") continue;
    try {
      out.push(JSON.parse(payloadText) as UIMessageFrame);
    } catch {
      // Malformed JSON in a fixture would be a test bug; skip silently here so
      // tests assert on the parseable payload set rather than the parser.
      continue;
    }
  }
  return out;
}

/**
 * Convenience: extract every `data-chat-event` payload (a `ChatEvent`) from an
 * SSE response body in the order they were emitted.
 */
export function chatEvents(frames: UIMessageFrame[]): unknown[] {
  return frames.filter((f) => f.type === "data-chat-event").map((f) => f.data);
}

/**
 * Convenience: extract every `data-agent-request` payload (an `AgentRequest`)
 * from an SSE response body in the order they were emitted.
 */
export function agentRequests(frames: UIMessageFrame[]): unknown[] {
  return frames.filter((f) => f.type === "data-agent-request").map((f) => f.data);
}
