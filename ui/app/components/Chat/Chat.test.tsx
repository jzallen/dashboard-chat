// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineageNode } from "../../catalog";
import { fixtureSource } from "../../catalog";
import { installCatalogForTest } from "../useCatalog";
import { AssistantOverlay } from "./Chat";

// AssistantOverlay calls useRevalidator() to trigger the framework revalidator
// after transform_applied SSE events. Stub it here so the overlay renders
// without a full data-router context.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }) };
});

beforeEach(async () => {
  await installCatalogForTest(fixtureSource, fixtureSource);
});
afterEach(() => vi.unstubAllGlobals());

function renderOverlay(context: LineageNode | null = null) {
  const noop = () => {};
  render(
    <AssistantOverlay
      context={context}
      onCreate={noop}
      onClose={noop}
      onOpenNode={noop}
      go={noop}
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
