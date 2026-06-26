/**
 * @vitest-environment happy-dom
 *
 * WALKING SKELETON — SSR ui-server gateway, slice 1 (live assistant chat wire).
 * Tag: @walking_skeleton @real-io
 *
 * Port-to-port proof of the FIRST slice of the SSR-as-ui-server progression:
 *
 *   AssistantOverlay submit        (client driving port — the user)
 *     -> POST /ui-server/chat            (the ui/ SERVER broker: a REAL RRv7 resource
 *                                    route action, NOT a network stub)
 *       -> POST /worker/chat       (the SOLE mocked downstream port: auth-proxy's
 *                                    agent upstream, stubbed via fetch)
 *     <- SSE relayed straight back (un-buffered Response(upstream.body) passthrough)
 *   <- streamed assistant text lands in the transcript
 *      AND a transform_applied domain event triggers catalog.revalidateScope()
 *
 * The setTimeout mock (catalog.getChatScript replay) is GONE for this path — the
 * overlay drives a real network turn. Only the true external boundary (the agent,
 * reached through auth-proxy at AUTH_PROXY_URL + /worker/chat) is faked; the broker
 * hop and the client are both real. See distill/wave-decisions.md (DWD-5, DWD-6).
 *
 * RED until DELIVER lands steps 4-7 (the /ui-server/chat action, the SSE reader, the
 * AssistantOverlay rewire, and the public catalog.revalidateScope()).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { fixtureSource } from "../catalog";
import { AssistantOverlay } from "../components/Chat/Chat";
import { catalog, installCatalogForTest } from "../components/useCatalog";
import { action as uiServerChatAction } from "../routes/ui-server/chat";

// The downstream origin the server-side broker targets (agent via auth-proxy).
const AUTH_PROXY_URL = "http://auth-proxy.test";

/**
 * A canned agent SSE turn in the AI-SDK-v6 UIMessage frame shape the agent emits
 * (see frontend/src/core/chat/services/chatStream.ts): two text deltas, one
 * `transform_applied` domain event, then finish.
 */
function agentSse(): string {
  const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  return (
    frame({ type: "text-delta", id: "t1", delta: "Trimmed " }) +
    frame({ type: "text-delta", id: "t1", delta: "whitespace in city." }) +
    frame({
      type: "data-chat-event",
      id: "e1",
      data: {
        type: "transform_applied",
        transform_id: "tr-1",
        dataset_id: "ds-1",
        operation: "trim",
        column: "city",
      },
    }) +
    frame({ type: "finish", finishReason: "stop" }) +
    "data: [DONE]\n\n"
  );
}

const realFetch = globalThis.fetch;

beforeAll(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
  // Route fetch: /worker/chat is the SOLE mock; /ui-server/chat runs the REAL broker
  // action so the server hop is exercised, not stubbed.
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/worker/chat")) {
        return new Response(agentSse(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.includes("/ui-server/chat")) {
        const request =
          input instanceof Request
            ? input
            : new Request(new URL("/ui-server/chat", "http://localhost"), init);
        return uiServerChatAction({ request, params: {}, context: {} } as never);
      }
      throw new Error(`unexpected fetch in acceptance test: ${url}`);
    },
  );
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  // A fixture-backed catalog so the overlay's useCatalog() has a live store and
  // makes no real network calls of its own.
  await installCatalogForTest(fixtureSource, fixtureSource);
});

describe("SSR ui-server gateway · slice 1 · live assistant chat wire", () => {
  it("streams a real assistant turn through /ui-server/chat and revalidates the catalog on transform_applied", async () => {
    const revalidateSpy = vi
      .spyOn(catalog, "revalidateScope")
      .mockResolvedValue(undefined);

    const noop = () => {};
    render(
      <AssistantOverlay
        context={null}
        onCreate={noop}
        onClose={noop}
        onOpenNode={noop}
        go={noop}
      />,
    );

    // Drive the REAL submit path (the setTimeout mock is gone).
    const box = screen.getByPlaceholderText(/describe a transform/i);
    fireEvent.change(box, { target: { value: "Trim whitespace in city" } });
    fireEvent.keyDown(box, { key: "Enter" });

    // The real streamed assistant text reaches the transcript.
    await waitFor(() =>
      expect(screen.getByText(/Trimmed whitespace in city\./)).toBeTruthy(),
    );

    // The transform_applied domain event triggered a scoped catalog revalidation.
    await waitFor(() => expect(revalidateSpy).toHaveBeenCalled());
  });
});
