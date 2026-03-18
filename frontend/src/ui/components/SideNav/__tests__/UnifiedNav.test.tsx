import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedNav } from "../UnifiedNav";

// --- Mocks ---

const mockNavigate = vi.fn();
const mockPathname = { current: "/" };

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname.current }),
}));

const mockQueryChannels = vi.fn().mockResolvedValue([]);
const mockClientOn = vi.fn();
const mockClientOff = vi.fn();
const mockStreamContext = {
  current: {
    client: { queryChannels: mockQueryChannels, on: mockClientOn, off: mockClientOff },
    isReady: true,
  },
};

vi.mock("@/stream/StreamProvider", () => ({
  useStreamContext: () => mockStreamContext.current,
}));

const mockResetSession = vi.fn();
vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({ resetSession: mockResetSession }),
}));

// --- Tests ---

describe("UnifiedNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.current = "/";
    mockQueryChannels.mockResolvedValue([]);
    mockStreamContext.current = {
      client: { queryChannels: mockQueryChannels, on: mockClientOn, off: mockClientOff },
      isReady: true,
    };
  });

  it("renders New Session, Projects, and All Chats buttons", () => {
    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    expect(screen.getByText("New Session")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("All Chats")).toBeInTheDocument();
  });

  it("highlights Projects when pathname starts with /projects", () => {
    mockPathname.current = "/projects/p1";
    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    const projectsBtn = screen.getByTestId("nav-projects");
    expect(projectsBtn.className).toContain("Active");
  });

  it("highlights All Chats when pathname is /sessions", () => {
    mockPathname.current = "/sessions";
    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    const sessionsBtn = screen.getByTestId("nav-sessions");
    expect(sessionsBtn.className).toContain("Active");
  });

  it("navigates to / on New Session click", () => {
    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    fireEvent.click(screen.getByTestId("new-session-btn"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("navigates to /projects on Projects click", () => {
    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    fireEvent.click(screen.getByTestId("nav-projects"));
    expect(mockNavigate).toHaveBeenCalledWith("/projects");
  });

  it("shows recent sessions from queryChannels", async () => {
    const mockChannels = [
      {
        id: "chat_org1_abc",
        data: { title: "My chat session" },
        state: { messages: [], last_message_at: new Date().toISOString() },
      },
      {
        id: "chat_org1_def",
        data: { title: null },
        state: {
          messages: [{ text: "Hello world this is a test message" }],
          last_message_at: new Date(Date.now() - 3600000).toISOString(),
        },
      },
    ];
    mockQueryChannels.mockResolvedValue(mockChannels);

    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    await waitFor(() => {
      expect(screen.getByText("My chat session")).toBeInTheDocument();
    });

    // Second session should show first message text
    expect(screen.getByText("Hello world this is a test message")).toBeInTheDocument();
  });

  it("navigates to /chat/:id on recent session click", async () => {
    const mockChannels = [
      {
        id: "chat_org1_abc",
        data: { title: "Test session" },
        state: { messages: [], last_message_at: new Date().toISOString() },
      },
    ];
    mockQueryChannels.mockResolvedValue(mockChannels);

    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    await waitFor(() => {
      expect(screen.getByText("Test session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("recent-session-chat_org1_abc"));
    expect(mockNavigate).toHaveBeenCalledWith("/chat/chat_org1_abc");
  });

  it("hides labels and recent sessions when collapsed", async () => {
    const mockChannels = [
      {
        id: "chat_org1_abc",
        data: { title: "Hidden session" },
        state: { messages: [], last_message_at: new Date().toISOString() },
      },
    ];
    mockQueryChannels.mockResolvedValue(mockChannels);

    render(<UnifiedNav orgId="org-1" collapsed={true} />);

    // Labels should be hidden
    expect(screen.queryByText("New Session")).not.toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();

    // Recent sessions should be hidden
    await waitFor(() => {
      expect(screen.queryByText("Hidden session")).not.toBeInTheDocument();
    });
  });
});
