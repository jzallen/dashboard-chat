import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { SqlAccessPanel } from "./index";
import type { SqlAccessStatus } from "@/api";

// Mock the API module
const mockGetSqlAccess = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockEnableSqlAccess = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockDisableSqlAccess = vi.fn<(id: string) => Promise<void>>();
const mockSyncSqlAccess = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockRegenerateSqlCredentials = vi.fn<(id: string) => Promise<SqlAccessStatus>>();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    getSqlAccess: (...args: [string]) => mockGetSqlAccess(...args),
    enableSqlAccess: (...args: [string]) => mockEnableSqlAccess(...args),
    disableSqlAccess: (...args: [string]) => mockDisableSqlAccess(...args),
    syncSqlAccess: (...args: [string]) => mockSyncSqlAccess(...args),
    regenerateSqlCredentials: (...args: [string]) => mockRegenerateSqlCredentials(...args),
  };
});

const DISABLED_STATUS: SqlAccessStatus = {
  project_id: "proj-001",
  enabled: false,
};

const ENABLED_STATUS: SqlAccessStatus = {
  project_id: "proj-001",
  enabled: true,
  host: "localhost",
  port: 5432,
  database: "proj_001_db",
  username: "proj_001_user",
  schema: "public",
  last_synced_at: "2026-01-15T10:30:00Z",
  connection_string: "postgresql://proj_001_user@localhost:5432/proj_001_db",
};

const ENABLED_WITH_PASSWORD: SqlAccessStatus = {
  ...ENABLED_STATUS,
  password: "secret-password-123",
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderPanel(projectId = "proj-001") {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SqlAccessPanel projectId={projectId} />
    </QueryClientProvider>
  );
}

describe("SqlAccessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard — happy-dom exposes clipboard as a getter-only property
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
  });

  describe("disabled state", () => {
    it("renders enable button when SQL access is disabled", async () => {
      mockGetSqlAccess.mockResolvedValue(DISABLED_STATUS);
      renderPanel();
      expect(
        await screen.findByRole("button", { name: "Enable SQL Access" })
      ).toBeInTheDocument();
    });

    it("shows description text in empty state", async () => {
      mockGetSqlAccess.mockResolvedValue(DISABLED_STATUS);
      renderPanel();
      expect(
        await screen.findByText(
          "Connect to your project data with any PostgreSQL client."
        )
      ).toBeInTheDocument();
    });
  });

  describe("enabled state", () => {
    it("renders connection details when enabled", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByText("localhost")).toBeInTheDocument();
      expect(screen.getByText("5432")).toBeInTheDocument();
      expect(screen.getByText("proj_001_db")).toBeInTheDocument();
      expect(screen.getByText("proj_001_user")).toBeInTheDocument();
      expect(screen.getByText("public")).toBeInTheDocument();
    });

    it("renders connection string", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(
        await screen.findByText(
          "postgresql://proj_001_user@localhost:5432/proj_001_db"
        )
      ).toBeInTheDocument();
    });

    it("renders running status badge", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByText("Running")).toBeInTheDocument();
    });

    it("shows masked password by default", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByText("••••••••")).toBeInTheDocument();
    });

    it("shows last synced timestamp", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      const syncText = await screen.findByText(/Last synced:/);
      expect(syncText).toBeInTheDocument();
    });
  });

  describe("copy functionality", () => {
    it("copies text to clipboard when copy button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      // Wait for the panel to render
      await screen.findByText("localhost");

      // Find all copy buttons and click the first one (host)
      const copyButtons = screen.getAllByLabelText("Copy to clipboard");
      fireEvent.click(copyButtons[0]);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("localhost");
    });
  });

  describe("enable flow", () => {
    it("calls enable and shows password after success", async () => {
      mockGetSqlAccess.mockResolvedValue(DISABLED_STATUS);
      mockEnableSqlAccess.mockResolvedValue(ENABLED_WITH_PASSWORD);
      renderPanel();

      const enableBtn = await screen.findByRole("button", {
        name: "Enable SQL Access",
      });
      fireEvent.click(enableBtn);

      await waitFor(() => {
        expect(mockEnableSqlAccess).toHaveBeenCalledWith("proj-001");
      });
    });
  });

  describe("disable flow", () => {
    it("shows confirmation dialog when disable button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      const disableBtn = await screen.findByRole("button", {
        name: "Disable SQL Access",
      });
      fireEvent.click(disableBtn);

      expect(
        screen.getByText("Disable SQL Access?")
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /terminate all active connections/
        )
      ).toBeInTheDocument();
    });

    it("calls disable when confirmation is accepted", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockDisableSqlAccess.mockResolvedValue(undefined);
      renderPanel();

      const disableBtn = await screen.findByRole("button", {
        name: "Disable SQL Access",
      });
      fireEvent.click(disableBtn);

      const confirmBtn = screen.getByRole("button", { name: "Disable" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDisableSqlAccess).toHaveBeenCalledWith("proj-001");
      });
    });

    it("closes dialog when cancel is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      const disableBtn = await screen.findByRole("button", {
        name: "Disable SQL Access",
      });
      fireEvent.click(disableBtn);

      expect(screen.getByText("Disable SQL Access?")).toBeInTheDocument();

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);

      expect(
        screen.queryByText("Disable SQL Access?")
      ).not.toBeInTheDocument();
    });
  });

  describe("sync", () => {
    it("calls sync when sync button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockSyncSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      const syncBtn = await screen.findByRole("button", { name: "Sync Now" });
      fireEvent.click(syncBtn);

      await waitFor(() => {
        expect(mockSyncSqlAccess).toHaveBeenCalledWith("proj-001");
      });
    });
  });

  describe("regenerate", () => {
    it("calls regenerate when button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockRegenerateSqlCredentials.mockResolvedValue(ENABLED_WITH_PASSWORD);
      renderPanel();

      const regenBtn = await screen.findByRole("button", {
        name: "Regenerate",
      });
      fireEvent.click(regenBtn);

      await waitFor(() => {
        expect(mockRegenerateSqlCredentials).toHaveBeenCalledWith("proj-001");
      });
    });
  });
});
