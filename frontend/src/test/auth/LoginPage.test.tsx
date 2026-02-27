import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LoginPage } from "../../lib/ui/components/LoginPage";

const mockLogin = vi.fn();

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it("calls login() when not authenticated", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(mockLogin).toHaveBeenCalledOnce();
  });

  it("shows redirecting message", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Redirecting to login...")).toBeInTheDocument();
  });
});
