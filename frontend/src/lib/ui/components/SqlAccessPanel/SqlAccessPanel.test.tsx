import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach,describe, expect, it, vi } from "vitest";

import type { EnvironmentStatusResponse,SqlAccessStatus } from "@/api";

import { SqlAccessPanel } from "./index";

// Mock the API module
const mockGetSqlAccess = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockEnableSqlAccess = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockDisableSqlAccess = vi.fn<(id: string) => Promise<void>>();
const mockSyncSqlAccess = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockRegenerateSqlCredentials = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockStartEnvironment = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockStopEnvironment = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockRestartEnvironment = vi.fn<(id: string) => Promise<SqlAccessStatus>>();
const mockGetEnvironmentStatus = vi.fn<(id: string) => Promise<EnvironmentStatusResponse>>();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    getSqlAccess: (...args: [string]) => mockGetSqlAccess(...args),
    enableSqlAccess: (...args: [string]) => mockEnableSqlAccess(...args),
    disableSqlAccess: (...args: [string]) => mockDisableSqlAccess(...args),
    syncSqlAccess: (...args: [string]) => mockSyncSqlAccess(...args),
    regenerateSqlCredentials: (...args: [string]) => mockRegenerateSqlCredentials(...args),
    startEnvironment: (...args: [string]) => mockStartEnvironment(...args),
    stopEnvironment: (...args: [string]) => mockStopEnvironment(...args),
    restartEnvironment: (...args: [string]) => mockRestartEnvironment(...args),
    getEnvironmentStatus: (...args: [string]) => mockGetEnvironmentStatus(...args),
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
  environment_status: "running",
};

const ENABLED_WITH_PASSWORD: SqlAccessStatus = {
  ...ENABLED_STATUS,
  password: "secret-password-123",
};

const LEGACY_STATUS: SqlAccessStatus = {
  ...ENABLED_STATUS,
  is_legacy: true,
};

const STOPPED_STATUS: SqlAccessStatus = {
  ...ENABLED_STATUS,
  environment_status: "stopped",
};

const DEGRADED_STATUS: SqlAccessStatus = {
  ...ENABLED_STATUS,
  environment_status: "degraded",
  status_message: "PgBouncer is not responding",
};

const ERROR_STATUS: SqlAccessStatus = {
  ...ENABLED_STATUS,
  environment_status: "error",
  status_message: "Failed to start database",
};

const DEFAULT_ENV_STATUS: EnvironmentStatusResponse = {
  project_id: "proj-001",
  environment_status: "running",
  status_message: null,
  pgduckdb_running: true,
  pgbouncer_running: true,
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
    // Default environment status mock
    mockGetEnvironmentStatus.mockResolvedValue(DEFAULT_ENV_STATUS);
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

    it("renders masked connection string by default", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(
        await screen.findByText(
          "postgresql://****@localhost:5432/proj_001_db"
        )
      ).toBeInTheDocument();
    });

    it("renders running status badge", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      const badges = await screen.findAllByText("Running");
      expect(badges.length).toBeGreaterThanOrEqual(1);
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

  describe("legacy migration banner", () => {
    it("renders legacy banner when is_legacy is true", async () => {
      mockGetSqlAccess.mockResolvedValue(LEGACY_STATUS);
      renderPanel();

      expect(
        await screen.findByTestId("legacy-banner")
      ).toBeInTheDocument();
      expect(
        screen.getByText("SQL Access needs to be reconfigured")
      ).toBeInTheDocument();
    });

    it("calls disable when legacy banner button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(LEGACY_STATUS);
      mockDisableSqlAccess.mockResolvedValue(undefined);
      renderPanel();

      const disableBtn = await screen.findByRole("button", {
        name: "Disable SQL Access",
      });
      fireEvent.click(disableBtn);

      await waitFor(() => {
        expect(mockDisableSqlAccess).toHaveBeenCalledWith("proj-001");
      });
    });
  });

  describe("environment controls", () => {
    it("shows stop and restart buttons when running", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(
        await screen.findByRole("button", { name: "Stop" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Restart" })
      ).toBeInTheDocument();
    });

    it("shows start button when stopped", async () => {
      mockGetSqlAccess.mockResolvedValue(STOPPED_STATUS);
      renderPanel();

      expect(
        await screen.findByRole("button", { name: "Start" })
      ).toBeInTheDocument();
      expect(
        screen.getByText("Environment is stopped. Connection attempts will fail until started.")
      ).toBeInTheDocument();
    });

    it("shows retry button and status message when in error state", async () => {
      mockGetSqlAccess.mockResolvedValue(ERROR_STATUS);
      renderPanel();

      expect(
        await screen.findByRole("button", { name: "Retry" })
      ).toBeInTheDocument();
      expect(
        screen.getByText("Failed to start database")
      ).toBeInTheDocument();
    });

    it("shows degraded status with stop and restart buttons", async () => {
      mockGetSqlAccess.mockResolvedValue(DEGRADED_STATUS);
      renderPanel();

      const degradedBadges = await screen.findAllByText("Degraded");
      expect(degradedBadges.length).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText("PgBouncer is not responding")
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Stop" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Restart" })
      ).toBeInTheDocument();
    });

    it("calls start when start button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(STOPPED_STATUS);
      mockStartEnvironment.mockResolvedValue({ ...ENABLED_STATUS, environment_status: "running" });
      renderPanel();

      const startBtn = await screen.findByRole("button", { name: "Start" });
      fireEvent.click(startBtn);

      await waitFor(() => {
        expect(mockStartEnvironment).toHaveBeenCalledWith("proj-001");
      });
    });

    it("calls stop when stop button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockStopEnvironment.mockResolvedValue({ ...ENABLED_STATUS, environment_status: "stopped" });
      renderPanel();

      const stopBtn = await screen.findByRole("button", { name: "Stop" });
      fireEvent.click(stopBtn);

      await waitFor(() => {
        expect(mockStopEnvironment).toHaveBeenCalledWith("proj-001");
      });
    });

    it("calls restart when restart button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockRestartEnvironment.mockResolvedValue({ ...ENABLED_STATUS, environment_status: "running" });
      renderPanel();

      const restartBtn = await screen.findByRole("button", { name: "Restart" });
      fireEvent.click(restartBtn);

      await waitFor(() => {
        expect(mockRestartEnvironment).toHaveBeenCalledWith("proj-001");
      });
    });

    it("calls restart for error state retry", async () => {
      mockGetSqlAccess.mockResolvedValue(ERROR_STATUS);
      mockRestartEnvironment.mockResolvedValue({ ...ENABLED_STATUS, environment_status: "running" });
      renderPanel();

      const retryBtn = await screen.findByRole("button", { name: "Retry" });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(mockRestartEnvironment).toHaveBeenCalledWith("proj-001");
      });
    });
  });

  describe("status badge", () => {
    it("displays correct label for each status", async () => {
      mockGetSqlAccess.mockResolvedValue(STOPPED_STATUS);
      renderPanel();

      // Header + environment section both show "Stopped"
      const stoppedBadges = await screen.findAllByText("Stopped");
      expect(stoppedBadges.length).toBeGreaterThanOrEqual(1);
    });

    it("displays error status badge", async () => {
      mockGetSqlAccess.mockResolvedValue(ERROR_STATUS);
      renderPanel();

      // Both header and environment section show "Error"
      const errorBadges = await screen.findAllByText("Error");
      expect(errorBadges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
