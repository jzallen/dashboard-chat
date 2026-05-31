// Acceptance scenarios for the shell-level Assistant (MR-4).
//
// Authored RED by DISTILL (path-forward.md §2.4, §4.4, §9). The assistant is a pure
// presentation RESHELL of the existing chat plumbing: a bottom-right FAB toggles it
// open; light mode renders a glass/comic overlay and dark mode a docked TUI terminal,
// both rendering the SAME chat feed from the existing ChatProvider context. Recents
// come from the existing useSessions hook; New Session resets the session; history
// navigates to All Chats (/sessions). The ui-state wire is NOT touched — the chat
// context + sessions hook are doubled at their boundaries.
//
// happy-dom does not apply stylesheets, so these assert structure / testids /
// navigation (via createRoutesStub) and the dark→terminal / light→glass STRUCTURAL
// branch — never computed colors (DWD-M4-2). Dark mode is driven by the `dark` root
// class (the authoritative flag useIsDark reads), set on documentElement per test.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../types";
import { Assistant } from "./index";

// ─────────────────────── port-boundary doubles ───────────────────────

const resetSession = vi.fn();
const setInput = vi.fn();
const handleSubmit = vi.fn((e: { preventDefault?: () => void }) => e.preventDefault?.());
const handleDatasetSelected = vi.fn();
const addMessage = vi.fn();

// Mutable so individual tests can drive the feed's message state.
const chat: { messages: Message[]; input: string; isLoading: boolean } = {
  messages: [],
  input: "",
  isLoading: false,
};

vi.mock("../../context/ChatContext", () => ({
  useChatContext: () => ({
    messages: chat.messages,
    input: chat.input,
    setInput,
    isLoading: chat.isLoading,
    handleSubmit,
    chatEndRef: { current: null },
    resetSession,
    handleDatasetSelected,
    addMessage,
  }),
}));

// Recents come from the existing useSessions hook (the listSessions port).
vi.mock("../../hooks/useSessions", () => ({
  useSessions: () => ({
    data: {
      pages: [
        {
          data: [
            {
              id: "s1",
              title: "Quarterly revenue",
              owner_id: "u1",
              last_active_at: null,
              stream_thread_id: null,
            },
          ],
          meta: { has_more: false, next_cursor: null },
        },
      ],
    },
    isLoading: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));

const projects = [
  { id: "p1", name: "Alpha", description: null, created_at: "", updated_at: "" },
];

afterEach(() => {
  cleanup();
  resetSession.mockClear();
  handleSubmit.mockClear();
  setInput.mockClear();
  chat.messages = [];
  chat.input = "";
  chat.isLoading = false;
  document.documentElement.className = "";
});

// ─────────────────────────── render harness ───────────────────────────

function renderAssistantAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Stub = createRoutesStub([
    // The assistant floats over the shell; render it at every relevant path so its
    // navigation lands on a distinguishable destination.
    { path: "/", Component: () => <Assistant projects={projects} /> },
    { path: "sessions", Component: () => <div data-testid="dest-sessions" /> },
    {
      path: "chat/:channelId",
      Component: () => <div data-testid="dest-chat" />,
    },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[path]} />
    </QueryClientProvider>,
  );
}

// ─────────────────────────────── scenarios ───────────────────────────────

describe("Assistant — FAB toggles the overlay", () => {
  it("renders the bottom-right FAB and no overlay until it is opened", async () => {
    renderAssistantAt("/");

    expect(await screen.findByTestId("assistant-fab")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-glass")).toBeNull();
    expect(screen.queryByTestId("assistant-terminal")).toBeNull();
  });

  it("opens the glass overlay on FAB click and closes it again", async () => {
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));
    expect(await screen.findByTestId("assistant-glass")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("assistant-close"));
    expect(screen.queryByTestId("assistant-glass")).toBeNull();
  });
});

describe("Assistant — renders the existing chat feed from context", () => {
  it("shows the streamed messages and the chat input inside the overlay", async () => {
    chat.messages = [
      { id: "m1", role: "assistant", content: "Hello from the existing chat wire" },
    ];
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));

    expect(await screen.findByTestId("assistant-feed")).toBeInTheDocument();
    expect(
      screen.getByText("Hello from the existing chat wire"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });
});

describe("Assistant — overlay-internal session controls", () => {
  it("resets the chat session on New Session", async () => {
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));
    fireEvent.click(await screen.findByTestId("assistant-new-session"));

    expect(resetSession).toHaveBeenCalledTimes(1);
  });

  it("navigates to All Chats (/sessions) from the history control", async () => {
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));
    fireEvent.click(await screen.findByTestId("assistant-history"));

    expect(await screen.findByTestId("dest-sessions")).toBeInTheDocument();
  });

  it("lists recent chats from the sessions hook and deep-links to the chosen one", async () => {
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));
    const chip = await screen.findByTestId("assistant-recent-s1");
    expect(chip).toHaveTextContent("Quarterly revenue");

    fireEvent.click(chip);
    expect(await screen.findByTestId("dest-chat")).toBeInTheDocument();
  });
});

describe("Assistant — dark mode renders the docked TUI terminal", () => {
  it("renders the terminal (not the glass overlay) when the dark root class is set", async () => {
    document.documentElement.className = "theme-neobrutalist dark";
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));

    expect(await screen.findByTestId("assistant-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-glass")).toBeNull();
    // Same feed, different chrome.
    expect(screen.getByTestId("assistant-feed")).toBeInTheDocument();
  });

  it("renders the glass overlay (not the terminal) in light mode", async () => {
    document.documentElement.className = "theme-neobrutalist";
    renderAssistantAt("/");

    fireEvent.click(await screen.findByTestId("assistant-fab"));

    expect(await screen.findByTestId("assistant-glass")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-terminal")).toBeNull();
  });
});

describe("Assistant — hidden while the org settings sheet is open", () => {
  it("does not render the FAB when the ?org=1 sheet is open (no overlap)", async () => {
    renderAssistantAt("/?org=1");

    // Give the router a tick; the FAB must be absent so it never overlaps the sheet.
    await Promise.resolve();
    expect(screen.queryByTestId("assistant-fab")).toBeNull();
  });
});
