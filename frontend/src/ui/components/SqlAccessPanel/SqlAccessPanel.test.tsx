import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlAccessStatus } from "@/dataCatalog";

import { SqlAccessPanel } from "./index";

const {
  mockGetSqlAccess,
  mockEnableSqlAccess,
  mockDisableSqlAccess,
  mockSyncSqlAccess,
  mockRegenerateSqlCredentials,
} = vi.hoisted(() => ({
  mockGetSqlAccess: vi.fn(),
  mockEnableSqlAccess: vi.fn(),
  mockDisableSqlAccess: vi.fn(),
  mockSyncSqlAccess: vi.fn(),
  mockRegenerateSqlCredentials: vi.fn(),
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      getSqlAccess: mockGetSqlAccess,
      enableSqlAccess: mockEnableSqlAccess,
      disableSqlAccess: mockDisableSqlAccess,
      syncSqlAccess: mockSyncSqlAccess,
      regenerateSqlCredentials: mockRegenerateSqlCredentials,
    }),
  };
});

vi.mock("@/auth", () => ({
  withAuth: (fn: typeof fetch) => fn,
}));

const DISABLED_STATUS: SqlAccessStatus = {
  project_id: "proj-001",
  enabled: false,
};

const ENABLED_STATUS: SqlAccessStatus = {
  project_id: "proj-001",
  enabled: true,
  host: "query-engine",
  port: 5432,
  database: "dashboard_external",
  username: "proxy_proj001",
  schema: "project_proj001",
  last_synced_at: "2026-01-15T10:30:00Z",
  engine_node_id: "engine-001",
  datasets: [
    { dataset_id: "ds-1", name: "Orders", view_name: "orders", sync_status: "synced" },
    { dataset_id: "ds-2", name: "Customers", view_name: "customers", sync_status: "pending" },
  ],
};

const ENABLED_WITH_PASSWORD: SqlAccessStatus = {
  ...ENABLED_STATUS,
  password: "secret-password-123", // pragma: allowlist secret
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SqlAccessPanel projectId={projectId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SqlAccessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        await screen.findByRole("button", { name: "Enable SQL Access" }),
      ).toBeInTheDocument();
    });
  });

  describe("enabled state", () => {
    it("renders connection details when enabled", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByText("query-engine")).toBeInTheDocument();
      expect(screen.getByText("5432")).toBeInTheDocument();
      expect(screen.getByText("dashboard_external")).toBeInTheDocument();
      expect(screen.getByText("proxy_proj001")).toBeInTheDocument();
      expect(screen.getByText("project_proj001")).toBeInTheDocument();
    });

    it("shows link to engine detail view", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByText("View Engine")).toBeInTheDocument();
    });

    it("shows per-dataset sync status", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByText("Orders")).toBeInTheDocument();
      expect(screen.getByText("Customers")).toBeInTheDocument();
      expect(screen.getByText("Synced")).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    it("shows Force Sync button instead of environment controls", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      expect(await screen.findByRole("button", { name: "Force Sync" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
    });
  });

  describe("disable flow", () => {
    it("shows confirmation dialog when disable button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      const disableBtn = await screen.findByRole("button", { name: "Disable SQL Access" });
      fireEvent.click(disableBtn);

      expect(screen.getByText("Disable SQL Access?")).toBeInTheDocument();
    });

    it("calls disable when confirmed", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockDisableSqlAccess.mockResolvedValue(undefined);
      renderPanel();

      fireEvent.click(await screen.findByRole("button", { name: "Disable SQL Access" }));
      fireEvent.click(screen.getByRole("button", { name: "Disable" }));

      await waitFor(() => {
        expect(mockDisableSqlAccess).toHaveBeenCalledWith("proj-001");
      });
    });
  });

  describe("sync", () => {
    it("calls sync when Force Sync button is clicked", async () => {
      mockGetSqlAccess.mockResolvedValue(ENABLED_STATUS);
      mockSyncSqlAccess.mockResolvedValue(ENABLED_STATUS);
      renderPanel();

      fireEvent.click(await screen.findByRole("button", { name: "Force Sync" }));

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

      fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));

      await waitFor(() => {
        expect(mockRegenerateSqlCredentials).toHaveBeenCalledWith("proj-001");
      });
    });
  });
});
