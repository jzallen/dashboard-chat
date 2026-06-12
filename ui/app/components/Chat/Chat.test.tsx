// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtureSource } from "../../catalog";
import { installCatalogForTest } from "../useCatalog";
import { AssistantOverlay } from "./Chat";

beforeEach(async () => {
  await installCatalogForTest(fixtureSource, fixtureSource);
});
afterEach(() => vi.unstubAllGlobals());

function renderOverlay() {
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
}

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
