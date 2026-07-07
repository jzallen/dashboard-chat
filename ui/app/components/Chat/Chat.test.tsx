// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineageNode } from "../../catalog";
import { fixtureSource } from "../../catalog";
import { renderInShell } from "../../lib/testRouter";
import { installCatalogForTest } from "../useCatalog";
import { AssistantOverlay } from "./Chat";

/**
 * A stream whose frames are pushed one at a time under test control, so a turn
 * can be started, the overlay unmounted, and only THEN the mutating event
 * delivered — proving the aborted turn no longer touches the torn-down tree.
 */
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (frame: string) => controller.enqueue(encoder.encode(frame)),
    close: () => controller.close(),
  };
}

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

// AssistantOverlay calls useRevalidator() to trigger the framework revalidator
// after transform_applied SSE events. Stub it here so the overlay renders
// without a full data-router context; the stable spy lets a test assert the
// revalidator is not driven after the overlay unmounts.
const mockRevalidate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useRevalidator: () => ({ revalidate: mockRevalidate, state: "idle" }) };
});

beforeEach(async () => {
  await installCatalogForTest(fixtureSource, fixtureSource);
});
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};

function renderOverlay(context: LineageNode | null = null) {
  return renderInShell(
    <AssistantOverlay
      context={context}
      onCreate={noop}
      onClose={noop}
      onOpenNode={noop}
    />,
  );
}

const datasetNode: LineageNode = {
  id: "ds-1",
  label: "customers",
  sub: "raw upload",
  layer: "staging",
  ref: { fields: [] },
};

describe("AssistantOverlay — live chat error path", () => {
  it("shows an unavailable notice when the broker call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 502 })),
    );
    renderOverlay();

    const box = screen.getByPlaceholderText(/describe a transform/i);
    fireEvent.change(box, { target: { value: "trim city" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText(/assistant is unavailable/i)).toBeTruthy(),
    );
  });
});

describe("AssistantOverlay — streaming turn cancellation", () => {
  it("aborts the fetch and does not drive the revalidator when a mutating event arrives after unmount", async () => {
    mockRevalidate.mockClear();
    const wire = controllableStream();
    const abortSpy = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", abortSpy);
        return new Response(wire.stream, { status: 200 });
      }),
    );

    const { unmount } = renderInShell(
      <AssistantOverlay
        context={null}
        onCreate={noop}
        onClose={noop}
        onOpenNode={noop}
      />,
    );

    const box = screen.getByPlaceholderText(/describe a transform/i);
    fireEvent.change(box, { target: { value: "Trim whitespace in city" } });
    fireEvent.keyDown(box, { key: "Enter" });

    wire.push(frame({ type: "text-delta", id: "t1", delta: "Working…" }));
    await waitFor(() => expect(screen.getByText(/Working…/)).toBeTruthy());

    unmount();
    expect(abortSpy).toHaveBeenCalled();

    wire.push(
      frame({
        type: "data-chat-event",
        id: "e1",
        data: { type: "transform_applied", column: "city" },
      }),
    );
    wire.close();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

describe("AssistantOverlay — context indicator", () => {
  it("shows the dataset name AND its layer word when a context node is present", () => {
    renderOverlay(datasetNode);

    expect(screen.getByText("customers")).toBeTruthy();
    // The layer word is shown next to the name (dot + name + layer).
    expect(screen.getByText("staging")).toBeTruthy();
  });

  it("shows an explicit 'No dataset in context' chip when there is no context", () => {
    renderOverlay(null);

    expect(screen.getByText(/no dataset in context/i)).toBeTruthy();
  });
});
