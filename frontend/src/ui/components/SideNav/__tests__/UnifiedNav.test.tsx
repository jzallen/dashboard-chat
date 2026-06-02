import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedNav } from "../UnifiedNav";

// --- Mocks ---

const mockNavigate = vi.fn();
const mockPathname = { current: "/" };

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname.current }),
}));

const mockResetSession = vi.fn();
vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({ resetSession: mockResetSession }),
}));

const mockSessionsData = { current: undefined as unknown };
vi.mock("../../../hooks/useSessions", () => ({
  useSessions: () => ({ data: mockSessionsData.current }),
}));

const mockUpdateMutate = vi.fn();
vi.mock("../../../hooks/useUpdateSession", () => ({
  useUpdateSession: () => ({ mutate: mockUpdateMutate }),
}));

// --- Tests ---

describe("UnifiedNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.current = "/";
    mockSessionsData.current = undefined;
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

  it("shows recent sessions from useSessions", () => {
    mockSessionsData.current = {
      pages: [
        {
          data: [
            {
              id: "sess-1",
              title: "My chat session",
              last_active_at: new Date().toISOString(),
            },
            {
              id: "sess-2",
              title: null,
              last_active_at: new Date(Date.now() - 3600000).toISOString(),
            },
          ],
        },
      ],
    };

    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    expect(screen.getByText("My chat session")).toBeInTheDocument();
    // Second session should show fallback "New session" text
    expect(screen.getByText("New session")).toBeInTheDocument();
  });

  it("navigates to /chat/:id on recent session click", () => {
    mockSessionsData.current = {
      pages: [
        {
          data: [
            {
              id: "sess-abc",
              title: "Test session",
              last_active_at: new Date().toISOString(),
            },
          ],
        },
      ],
    };

    render(<UnifiedNav orgId="org-1" collapsed={false} />);

    expect(screen.getByText("Test session")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("recent-session-sess-abc"));
    expect(mockNavigate).toHaveBeenCalledWith("/chat/sess-abc");
  });

  it("hides labels and recent sessions when collapsed", () => {
    mockSessionsData.current = {
      pages: [
        {
          data: [
            {
              id: "sess-hidden",
              title: "Hidden session",
              last_active_at: new Date().toISOString(),
            },
          ],
        },
      ],
    };

    render(<UnifiedNav orgId="org-1" collapsed={true} />);

    // Labels should be hidden
    expect(screen.queryByText("New Session")).not.toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();

    // Recent sessions should be hidden
    expect(screen.queryByText("Hidden session")).not.toBeInTheDocument();
  });
});
