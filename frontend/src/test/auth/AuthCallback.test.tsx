import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthCallback } from "../../lib/ui/components/AuthCallback";

const mockHandleCallback = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../lib/auth", () => ({
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
  });

  it("calls handleCallback with code from URL params", async () => {
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test-auth-code"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockHandleCallback).toHaveBeenCalledWith("test-auth-code");
    });
  });

  it("navigates to / when user has org_id", async () => {
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=valid-code"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("navigates to /org/create when user has no org_id", async () => {
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: null, name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=valid-code"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/org/create", { replace: true });
    });
  });

  it("navigates to /login on failure", async () => {
    mockHandleCallback.mockRejectedValue(new Error("Invalid code"));

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=bad-code"]}>
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
    mockHandleCallback.mockResolvedValue({ id: "u1", email: "a@b.c", org_id: "org-1", name: null });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Completing login...")).toBeInTheDocument();
  });
});
