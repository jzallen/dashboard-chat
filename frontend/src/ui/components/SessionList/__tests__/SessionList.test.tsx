import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionList } from "..";

// --- Mocks ---

vi.mock("../../../hooks/useDatasetQuery", () => ({
  useDatasetQuery: (id: string) => ({
    data: id ? { name: `Dataset ${id}` } : undefined,
  }),
}));

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({ orgId: "org-1", orgName: "Test Org", project: null, projects: null }),
  useNavigate: () => mockNavigate,
}));

const mockQueryChannels = vi.fn().mockResolvedValue([]);
const mockUpdatePartial = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stream/StreamProvider", () => ({
  useStreamContext: () => ({
    client: { queryChannels: mockQueryChannels },
    isReady: true,
  }),
}));

function makeMockChannel(overrides: {
  id: string;
  title?: string | null;
  datasetId?: string | null;
  messages?: Array<{ text: string }>;
  lastMessageAt?: string;
}) {
  return {
    id: overrides.id,
    data: {
      title: overrides.title ?? null,
      datasetId: overrides.datasetId ?? null,
    },
    state: {
      messages: overrides.messages ?? [],
      last_message_at: overrides.lastMessageAt ?? new Date().toISOString(),
    },
    updatePartial: mockUpdatePartial,
  };
}

// --- Tests ---

describe("SessionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryChannels.mockResolvedValue([]);
  });

  it("shows empty state when no sessions exist", async () => {
    render(<SessionList />);

    // waitFor retries until the async fetchChannels flow completes
    // and the loading state transitions to the empty message
    await waitFor(
      () => expect(screen.getByText(/No chat sessions/)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it("renders session rows from queried channels", async () => {
    const channels = [
      makeMockChannel({ id: "ch-1", title: "My first chat" }),
      makeMockChannel({
        id: "ch-2",
        title: null,
        messages: [{ text: "Hello there" }],
      }),
    ];
    mockQueryChannels.mockResolvedValue(channels);

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("My first chat")).toBeInTheDocument();
    });
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("navigates to /chat/:id on row click", async () => {
    mockQueryChannels.mockResolvedValue([
      makeMockChannel({ id: "ch-1", title: "Clickable session" }),
    ]);

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Clickable session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("session-ch-1"));
    expect(mockNavigate).toHaveBeenCalledWith("/chat/ch-1");
  });

  it("shows dataset badge with resolved name when datasetId is set", async () => {
    mockQueryChannels.mockResolvedValue([
      makeMockChannel({ id: "ch-1", title: "With dataset", datasetId: "ds-42" }),
    ]);

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Dataset ds-42")).toBeInTheDocument();
    });
  });

  it("enters edit mode on edit button click", async () => {
    mockQueryChannels.mockResolvedValue([
      makeMockChannel({ id: "ch-1", title: "Editable" }),
    ]);

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Editable")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-ch-1"));
    expect(screen.getByTestId("title-edit-input")).toBeInTheDocument();
    expect((screen.getByTestId("title-edit-input") as HTMLInputElement).value).toBe("Editable");
  });

  it("confirms title edit on Enter", async () => {
    const channel = makeMockChannel({ id: "ch-1", title: "Old title" });
    mockQueryChannels.mockResolvedValue([channel]);

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-ch-1"));
    const input = screen.getByTestId("title-edit-input");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockUpdatePartial).toHaveBeenCalledWith({ set: { title: "New title" } });
    });
  });

  it("cancels edit on Escape", async () => {
    mockQueryChannels.mockResolvedValue([
      makeMockChannel({ id: "ch-1", title: "Keep this" }),
    ]);

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Keep this")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-ch-1"));
    fireEvent.keyDown(screen.getByTestId("title-edit-input"), { key: "Escape" });

    // Should exit edit mode
    expect(screen.queryByTestId("title-edit-input")).not.toBeInTheDocument();
  });
});
