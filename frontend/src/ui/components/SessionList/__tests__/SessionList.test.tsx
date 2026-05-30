import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session, SessionsPage } from "@/dataCatalog";

// --- Mocks ---

const { mockListSessions, mockUpdateSession } = vi.hoisted(() => ({
  mockListSessions: vi.fn(),
  mockUpdateSession: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      listSessions: mockListSessions,
      updateSession: mockUpdateSession,
    }),
  };
});

const mockNavigate = vi.fn();

vi.mock("react-router", () => ({
  useOutletContext: () => ({ orgId: "org-1", orgName: "Test Org", project: null, projects: [{ id: "proj-1" }] }),
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
}));

import { SessionList } from "..";

// --- Helpers ---

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    memory_id: "mem-1",
    stream_thread_id: "thread-1",
    owner_id: "user-1",
    title: null,
    org_id: "org-1",
    created_at: "2025-01-01T00:00:00Z",
    last_active_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSessionsPage(sessions: Session[]): SessionsPage {
  return {
    data: sessions,
    meta: { next_cursor: null, has_more: false },
  };
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper });
}

// --- Tests ---

describe("SessionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessions.mockResolvedValue(makeSessionsPage([]));
    mockUpdateSession.mockResolvedValue(makeSession());
  });

  it("shows empty state when no sessions exist", async () => {
    renderWithQueryClient(<SessionList />);

    await waitFor(
      () => expect(screen.getByText(/No chat sessions/)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it("renders session rows from backend API", async () => {
    const sessions = [
      makeSession({ id: "sess-1", title: "My first chat" }),
      makeSession({ id: "sess-2", title: "Another chat" }),
    ];
    mockListSessions.mockResolvedValue(makeSessionsPage(sessions));

    renderWithQueryClient(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("My first chat")).toBeInTheDocument();
    });
    expect(screen.getByText("Another chat")).toBeInTheDocument();
  });

  it("navigates to /chat/:id on row click", async () => {
    mockListSessions.mockResolvedValue(
      makeSessionsPage([makeSession({ id: "sess-1", title: "Clickable session" })]),
    );

    renderWithQueryClient(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Clickable session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("session-sess-1"));
    expect(mockNavigate).toHaveBeenCalledWith("/chat/sess-1");
  });

  it("displays owner_id for each session", async () => {
    mockListSessions.mockResolvedValue(
      makeSessionsPage([makeSession({ id: "sess-1", title: "Owned session", owner_id: "user-42" })]),
    );

    renderWithQueryClient(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("user-42")).toBeInTheDocument();
    });
  });

  it("enters edit mode on edit button click", async () => {
    mockListSessions.mockResolvedValue(
      makeSessionsPage([makeSession({ id: "sess-1", title: "Editable" })]),
    );

    renderWithQueryClient(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Editable")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-sess-1"));
    expect(screen.getByTestId("title-edit-input")).toBeInTheDocument();
    expect((screen.getByTestId("title-edit-input") as HTMLInputElement).value).toBe("Editable");
  });

  it("confirms title edit on Enter and calls updateSession", async () => {
    const session = makeSession({ id: "sess-1", title: "Old title" });
    mockListSessions.mockResolvedValue(makeSessionsPage([session]));
    mockUpdateSession.mockResolvedValue({ ...session, title: "New title" });

    renderWithQueryClient(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-sess-1"));
    const input = screen.getByTestId("title-edit-input");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledWith("proj-1", "sess-1", { title: "New title" });
    });
  });

  it("cancels edit on Escape", async () => {
    mockListSessions.mockResolvedValue(
      makeSessionsPage([makeSession({ id: "sess-1", title: "Keep this" })]),
    );

    renderWithQueryClient(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Keep this")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-sess-1"));
    fireEvent.keyDown(screen.getByTestId("title-edit-input"), { key: "Escape" });

    // Should exit edit mode
    expect(screen.queryByTestId("title-edit-input")).not.toBeInTheDocument();
  });
});
