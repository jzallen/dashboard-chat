import { QueryClient } from "@tanstack/react-query";
import { beforeEach,describe, expect, it, vi } from "vitest";

import type { View } from "@/dataCatalog";

// Hoist mock fns so vi.mock factory can reference them
const { mockCreateView, mockUpdateView, mockDeleteView } = vi.hoisted(() => ({
  mockCreateView: vi.fn(),
  mockUpdateView: vi.fn(),
  mockDeleteView: vi.fn(),
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      createView: mockCreateView,
      updateView: mockUpdateView,
      deleteView: mockDeleteView,
    }),
  };
});

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

import {
  executeViewToolCall,
  handleCreateView,
  handleDeleteView,
  handleRenameView,
  handleSetMaterialization,
  type ViewToolContext,
} from "../viewTools";

function createContext(overrides?: Partial<ViewToolContext>): ViewToolContext {
  return {
    viewId: "view-1",
    projectId: "proj-1",
    queryClient: new QueryClient(),
    navigate: vi.fn(),
    setContext: vi.fn(),
    ...overrides,
  };
}

describe("viewTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleCreateView", () => {
    it("creates a view and switches context", async () => {
      const newView: View = {
        id: "view-new",
        project_id: "proj-1",
        org_id: "org-1",
        name: "New View",
        description: null,
        sql_definition: "",
        source_refs: [],
        materialization: "ephemeral",
        created_at: null,
        updated_at: null,
      };
      mockCreateView.mockResolvedValue(newView);
      const ctx = createContext();

      const result = await handleCreateView({ name: "New View" }, ctx);

      expect(result).toBe('Created view "New View"');
      expect(mockCreateView).toHaveBeenCalledWith("proj-1", {
        name: "New View",
        description: undefined,
        source_refs: undefined,
      });
      expect(ctx.setContext).toHaveBeenCalledWith("view", "view-new");
      expect(ctx.navigate).toHaveBeenCalledWith("/view/view-new");
    });
  });

  describe("handleRenameView", () => {
    it("renames and invalidates cache", async () => {
      mockUpdateView.mockResolvedValue({});
      const ctx = createContext();

      const result = await handleRenameView({ name: "Renamed" }, ctx);

      expect(result).toBe('Renamed view to "Renamed"');
      expect(mockUpdateView).toHaveBeenCalledWith("view-1", { name: "Renamed" });
    });
  });

  describe("handleSetMaterialization", () => {
    it("sets materialization strategy", async () => {
      mockUpdateView.mockResolvedValue({});
      const ctx = createContext();

      const result = await handleSetMaterialization({ strategy: "table" }, ctx);

      expect(result).toBe('Materialization set to "table"');
      expect(mockUpdateView).toHaveBeenCalledWith("view-1", { materialization: "table" });
    });
  });

  describe("handleDeleteView", () => {
    it("deletes view and navigates home", async () => {
      mockDeleteView.mockResolvedValue(undefined);
      const ctx = createContext();
      // Seed cache with view data
      ctx.queryClient.setQueryData(["views", "detail", "view-1"], {
        id: "view-1",
        name: "My View",
      });

      const result = await handleDeleteView(ctx);

      expect(result).toBe('Deleted view "My View"');
      expect(mockDeleteView).toHaveBeenCalledWith("view-1");
      expect(ctx.setContext).toHaveBeenCalledWith(null, null);
      expect(ctx.navigate).toHaveBeenCalledWith("/");
    });

    it("falls back to viewId when view not in cache", async () => {
      mockDeleteView.mockResolvedValue(undefined);
      const ctx = createContext();

      const result = await handleDeleteView(ctx);

      expect(result).toBe('Deleted view "view-1"');
    });
  });

  describe("executeViewToolCall", () => {
    it("dispatches to correct handler", async () => {
      mockUpdateView.mockResolvedValue({});
      const ctx = createContext();

      const result = await executeViewToolCall("renameView", { name: "Test" }, ctx);

      expect(result).toBe('Renamed view to "Test"');
    });

    it("returns error for unknown tool", async () => {
      const ctx = createContext();
      const result = await executeViewToolCall("unknownTool", {}, ctx);
      expect(result).toBe("Unknown view tool: unknownTool");
    });
  });
});
