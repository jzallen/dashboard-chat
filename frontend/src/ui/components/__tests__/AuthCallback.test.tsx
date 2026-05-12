import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AuthCallback } from "../../../ui/components/AuthCallback";

const mockHandleCallback = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../../ui/context/AuthContext", () => ({
  useAuth: () => ({
    handleCallback: mockHandleCallback,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("AuthCallback", () => {
  beforeEach(() => {
    mockHandleCallback.mockReset();
    mockNavigate.mockReset();
    sessionStorage.clear();
  });

  it("calls handleCallback with code from URL params when state matches", async () => {
    sessionStorage.setItem("oauth_state", "test-state-123");
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test-auth-code&state=test-state-123"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockHandleCallback).toHaveBeenCalledWith("test-auth-code");
    });
  });

  it("navigates to / when user has org_id", async () => {
    sessionStorage.setItem("oauth_state", "valid-state");
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=valid-code&state=valid-state"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("navigates to /org/create when user has no org_id", async () => {
    sessionStorage.setItem("oauth_state", "valid-state");
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: null, name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=valid-code&state=valid-state"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/org/create", { replace: true });
    });
  });

  it("navigates to /login on failure", async () => {
    sessionStorage.setItem("oauth_state", "valid-state");
    mockHandleCallback.mockRejectedValue(new Error("Invalid code"));

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=bad-code&state=valid-state"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    });
  });

  it("redirects to /login when no code param present", async () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    });
  });

  it("shows completing login message", () => {
    sessionStorage.setItem("oauth_state", "valid-state");
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test&state=valid-state"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Completing login...")).toBeInTheDocument();
  });

  describe("OAuth state verification", () => {
    it("proceeds with code exchange when state matches sessionStorage", async () => {
      sessionStorage.setItem("oauth_state", "abc-state-xyz");
      mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

      render(
        <MemoryRouter initialEntries={["/auth/callback?code=auth-code&state=abc-state-xyz"]}>
          <AuthCallback />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockHandleCallback).toHaveBeenCalledWith("auth-code");
      });
      expect(sessionStorage.getItem("oauth_state")).toBeNull();
    });

    it("redirects to /login when state param does not match sessionStorage", async () => {
      sessionStorage.setItem("oauth_state", "expected-state");

      render(
        <MemoryRouter initialEntries={["/auth/callback?code=auth-code&state=wrong-state"]}>
          <AuthCallback />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
      });
      expect(mockHandleCallback).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("oauth_state")).toBeNull();
    });

    it("redirects to /login when state query param is missing", async () => {
      sessionStorage.setItem("oauth_state", "stored-state");

      render(
        <MemoryRouter initialEntries={["/auth/callback?code=auth-code"]}>
          <AuthCallback />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
      });
      expect(mockHandleCallback).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("oauth_state")).toBeNull();
    });

    it("redirects to /login when sessionStorage has no oauth_state", async () => {
      // sessionStorage is empty — no oauth_state set

      render(
        <MemoryRouter initialEntries={["/auth/callback?code=auth-code&state=some-state"]}>
          <AuthCallback />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
      });
      expect(mockHandleCallback).not.toHaveBeenCalled();
    });

    it("removes oauth_state from sessionStorage after successful verification", async () => {
      sessionStorage.setItem("oauth_state", "cleanup-state");
      mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

      render(
        <MemoryRouter initialEntries={["/auth/callback?code=auth-code&state=cleanup-state"]}>
          <AuthCallback />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockHandleCallback).toHaveBeenCalled();
      });
      expect(sessionStorage.getItem("oauth_state")).toBeNull();
    });
  });
});
