import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach,describe, expect, it, vi } from "vitest";

const { mockLogin, mockCreateOrg } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockCreateOrg: vi.fn(),
}));

// Mock useAuth
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

// Mock @/auth
vi.mock("@/auth", () => ({
  withAuth: (fn: typeof fetch) => fn,
}));

// Mock @/dataCatalog
vi.mock("@/dataCatalog", () => ({
  createDataCatalog: () => ({
    createOrg: mockCreateOrg,
  }),
}));

import { CreateOrg } from "../CreateOrg/index";

describe("CreateOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders form with input and submit button", () => {
    render(<CreateOrg />);
    expect(screen.getByRole("heading", { name: "Create Organization" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Organization name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Organization" }),
    ).toBeDisabled();
  });

  it("enables submit button when name is entered", () => {
    render(<CreateOrg />);
    fireEvent.change(screen.getByPlaceholderText("Organization name"), {
      target: { value: "My Org" },
    });
    expect(
      screen.getByRole("button", { name: "Create Organization" }),
    ).toBeEnabled();
  });

  it("calls createOrg on submit and triggers login when requires_reauth", async () => {
    mockCreateOrg.mockResolvedValue({
      org_id: "org-123",
      org_name: "My Org",
      requires_reauth: true,
    });

    render(<CreateOrg />);
    fireEvent.change(screen.getByPlaceholderText("Organization name"), {
      target: { value: "My Org" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create Organization" }),
    );

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledWith("My Org");
      expect(mockLogin).toHaveBeenCalledWith("org-123");
    });
  });

  it("updates localStorage and redirects in dev mode (no reauth)", async () => {
    mockCreateOrg.mockResolvedValue({
      org_id: "org-456",
      org_name: "Dev Org",
      requires_reauth: false,
    });
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "u1", org_id: "" }),
    );

    // Mock window.location
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });

    render(<CreateOrg />);
    fireEvent.change(screen.getByPlaceholderText("Organization name"), {
      target: { value: "Dev Org" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create Organization" }),
    );

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledWith("Dev Org");
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("auth_user")!);
      expect(stored.org_id).toBe("org-456");
      expect(window.location.href).toBe("/");
    });

    // Restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("displays error message on failure", async () => {
    mockCreateOrg.mockRejectedValue(new Error("Server error"));

    render(<CreateOrg />);
    fireEvent.change(screen.getByPlaceholderText("Organization name"), {
      target: { value: "Fail Org" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create Organization" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
    // Button should be re-enabled after error
    expect(
      screen.getByRole("button", { name: "Create Organization" }),
    ).toBeEnabled();
  });

  it("shows Creating... text while submitting", async () => {
    let resolveCreateOrg: (v: unknown) => void;
    mockCreateOrg.mockReturnValue(
      new Promise((resolve) => {
        resolveCreateOrg = resolve;
      }),
    );

    render(<CreateOrg />);
    fireEvent.change(screen.getByPlaceholderText("Organization name"), {
      target: { value: "Slow Org" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create Organization" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Creating...")).toBeInTheDocument();
    });

    // Resolve to clean up
    resolveCreateOrg!({
      org_id: "org-789",
      org_name: "Slow Org",
      requires_reauth: true,
    });
  });
});
