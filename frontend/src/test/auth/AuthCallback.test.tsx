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
    mockHandleCallback.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test-auth-code"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockHandleCallback).toHaveBeenCalledWith("test-auth-code");
    });
  });

  it("navigates to /projects on success", async () => {
    mockHandleCallback.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=valid-code"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/projects", { replace: true });
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
    mockHandleCallback.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Completing login...")).toBeInTheDocument();
  });
});
