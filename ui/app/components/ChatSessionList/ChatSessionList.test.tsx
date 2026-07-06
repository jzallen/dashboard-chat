// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureFallback } from "../../../app/routes/_fixtureCatalog";
import type { ChatHistoryItem, PartialCatalogSource } from "../../catalog";
import { installCatalogForTest, seedProjectScoped } from "../useCatalog";
import { ChatSessionList } from "./ChatSessionList";

afterEach(() => vi.restoreAllMocks());

/** A fallback whose chats are a known fixture value (the seed shown first). */
function fallbackWithChat(): ReturnType<typeof fixtureFallback> {
  const base = fixtureFallback();
  const fixtureChat: ChatHistoryItem[] = [
    { title: "Fixture Session", nodeId: null },
  ];
  return { ...base, getAllChats: () => Promise.resolve(fixtureChat) };
}

describe("ChatSessionList — reactivity to backend session commits", () => {
  it("re-renders when the project's sessions land (subscribes via useCatalog)", async () => {
    // The project-layout loader seeds the scoped project's sessions via
    // seedProjectScoped — so the seeded fixture chat paints first, then the
    // component re-renders on the catalog commit with no user interaction.
    const backendChat: ChatHistoryItem[] = [
      { title: "Backend Session", nodeId: null, when: "2m ago" },
    ];
    const primary: PartialCatalogSource = {
      getProjects: () =>
        Promise.resolve([
          { id: "p1", name: "P1", desc: "", datasets: 0, models: 0 },
        ]),
    };

    await installCatalogForTest(primary, fallbackWithChat());

    render(<ChatSessionList go={vi.fn()} />);

    // Seeded fixture chat paints first…
    expect(screen.getByText("Fixture Session")).toBeTruthy();

    // …the loader seeds the scoped project's sessions, re-rendering the list with
    // NO user interaction. (Without the useCatalog() subscription the component
    // would stay on the seed.)
    await act(async () => {
      seedProjectScoped({
        projectId: "p1",
        nodes: {},
        edges: [],
        audit: {},
        dbtFiles: [],
        chats: backendChat,
        recents: [],
        sourceUploads: {},
      });
    });
    await waitFor(() => expect(screen.getByText("Backend Session")).toBeTruthy());
    expect(screen.queryByText("Fixture Session")).toBeNull();
  });
});
