import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "..";

// --- Mocks ---

const mockNavigate = vi.fn();
const mockChannelId = { current: undefined as string | undefined };
const mockOrgId = { current: "org-1" as string | null };

vi.mock("react-router", () => ({
  useParams: () => ({ channelId: mockChannelId.current }),
  useOutletContext: () => ({ orgId: mockOrgId.current, orgName: "Test Org", project: null, projects: null }),
  useNavigate: () => mockNavigate,
}));

const mockCreateChannel = vi.fn();
const mockLoadChannel = vi.fn();
const mockHandleSubmit = vi.fn();
const mockAddMessage = vi.fn();
const mockChannel = { current: null as { id: string; data: Record<string, unknown> } | null };

vi.mock("../../../../ui/context/ChatContext", () => ({
  useChatContext: () => ({
    messages: [],
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    handleSubmit: mockHandleSubmit,
    chatEndRef: { current: null },
    channel: mockChannel.current,
    createChannel: mockCreateChannel,
    loadChannel: mockLoadChannel,
    addMessage: mockAddMessage,
    isStreaming: false,
    streamingContent: "",
  }),
}));

const { mockListProjects } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
}));

vi.mock("@/dataCatalog", () => ({
  createDataCatalog: () => ({ listProjects: mockListProjects }),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

// --- Tests ---

describe("ChatView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannelId.current = undefined;
    mockOrgId.current = "org-1";
    mockChannel.current = null;
    mockCreateChannel.mockResolvedValue({ id: "chat_org1_abc123" });
    mockLoadChannel.mockResolvedValue({ id: "chat_org1_existing" });
    mockAddMessage.mockReset();
    mockListProjects.mockResolvedValue([
      { id: "proj-1", name: "Project 1" },
      { id: "proj-2", name: "Project 2" },
    ]);
  });

  it("renders welcome state when no messages", async () => {
    mockChannelId.current = "ch-1";
    mockChannel.current = { id: "ch-1", data: {} };

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Dashboard Chat")).toBeInTheDocument();
    });
  });

  it("renders ChatInput", async () => {
    mockChannelId.current = "ch-1";
    mockChannel.current = { id: "ch-1", data: {} };

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });
  });

  it("creates channel on mount at / and navigates", async () => {
    // No channelId → creates new session
    mockChannelId.current = undefined;

    render(<ChatView />);

    await waitFor(() => {
      expect(mockCreateChannel).toHaveBeenCalledWith("org-1");
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/chat/chat_org1_abc123",
        { replace: true },
      );
    });
  });

  it("loads channel on mount at /chat/:channelId", async () => {
    mockChannelId.current = "chat_org1_existing";

    render(<ChatView />);

    await waitFor(() => {
      expect(mockLoadChannel).toHaveBeenCalledWith("chat_org1_existing");
    });
  });

  it("skips loading if channel already matches", async () => {
    mockChannelId.current = "chat_org1_existing";
    mockChannel.current = { id: "chat_org1_existing", data: {} };

    render(<ChatView />);

    // Should not call loadChannel since channel.id matches
    await waitFor(() => {
      expect(mockLoadChannel).not.toHaveBeenCalled();
    });
  });

  it("clicking 'Upload a CSV' shows project picker when multiple projects", async () => {
    mockChannelId.current = "ch-1";
    mockChannel.current = { id: "ch-1", data: {} };

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Upload a CSV")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Upload a CSV"));

    await waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({ widget: { type: "upload" } }),
      );
    });
    expect(mockNavigate).not.toHaveBeenCalledWith("/projects");
  });

  it("clicking 'Upload a CSV' skips picker when single project", async () => {
    mockChannelId.current = "ch-1";
    mockChannel.current = { id: "ch-1", data: {} };
    mockListProjects.mockResolvedValue([{ id: "proj-1", name: "Only Project" }]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Upload a CSV")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Upload a CSV"));

    await waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          widget: { type: "file-upload", projectId: "proj-1" },
        }),
      );
    });
  });
});
