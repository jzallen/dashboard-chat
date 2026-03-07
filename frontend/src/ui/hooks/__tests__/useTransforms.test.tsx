import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, Transform, TransformCreate } from "@/dataCatalog";

// --- Mocks ---

const { mockCreateTransform, mockDeleteTransform, mockToggleTransform } =
  vi.hoisted(() => ({
    mockCreateTransform: vi.fn(),
    mockDeleteTransform: vi.fn(),
    mockToggleTransform: vi.fn(),
  }));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      createTransform: mockCreateTransform,
      deleteTransform: mockDeleteTransform,
      toggleTransform: mockToggleTransform,
    }),
  };
});

vi.mock("@/queryTranslation", () => ({
  raqbToTanstackFilters: vi.fn(
    (_json: unknown, opts: { transformId: string }) => ({
      filters: [
        {
          id: "col1",
          value: { operator: "eq", value: "test", transformId: opts.transformId },
        },
      ],
    }),
  ),
}));

import {
  useDeleteTransform,
  useSaveTransform,
  useToggleTransform,
  useTransforms,
} from "../useTransforms";
import { datasetKeys } from "../queryKeys";

// --- Helpers ---

function makeTransform(overrides: Partial<Transform> = {}): Transform {
  return {
    id: "t-1",
    name: "Filter 1",
    description: null,
    condition_json: null,
    condition_sql: null,
    status: "enabled",
    transform_type: "filter",
    target_column: null,
    expression_config: null,
    expression_sql: null,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "ds-1",
    project_id: "p-1",
    name: "Test",
    description: null,
    schema_config: { fields: {} },
    partition_fields: [],
    transforms: [],
    preview_rows: [],
    column_profiles: null,
    ...overrides,
  };
}

let queryClient: QueryClient;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// --- Tests ---

describe("useSaveTransform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically adds transform to cache", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    const created = makeTransform({ id: "t-new", name: "New Filter" });
    mockCreateTransform.mockResolvedValue(created);

    const { result } = renderHook(() => useSaveTransform("ds-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ name: "New Filter" });
    });

    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached?.transforms).toHaveLength(1);
    expect(cached?.transforms[0].name).toBe("New Filter");
    expect(cached?.transforms[0].status).toBe("enabled");
  });

  it("rolls back on error", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockCreateTransform.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useSaveTransform("ds-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "Bad Filter" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
      expect(cached?.transforms).toHaveLength(0);
    });
  });

  it("does nothing when cache is empty", async () => {
    const wrapper = createWrapper();
    const created = makeTransform();
    mockCreateTransform.mockResolvedValue(created);

    const { result } = renderHook(() => useSaveTransform("ds-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ name: "Filter" });
    });

    // No dataset in cache, setQueryData with updater returns undefined
    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached).toBeUndefined();
  });
});

describe("useDeleteTransform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically removes transform from cache", async () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({ id: "t-1" });
    const t2 = makeTransform({ id: "t-2", name: "Filter 2" });
    const dataset = makeDataset({ transforms: [t1, t2] });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockDeleteTransform.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteTransform("ds-1"), { wrapper });

    await act(async () => {
      result.current.mutate("t-1");
    });

    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached?.transforms).toHaveLength(1);
    expect(cached?.transforms[0].id).toBe("t-2");
  });

  it("rolls back on error", async () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({ id: "t-1" });
    const dataset = makeDataset({ transforms: [t1] });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockDeleteTransform.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useDeleteTransform("ds-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync("t-1");
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
      expect(cached?.transforms).toHaveLength(1);
    });
  });
});

describe("useToggleTransform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically toggles transform to disabled", async () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({ id: "t-1", status: "enabled" });
    const dataset = makeDataset({ transforms: [t1] });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockToggleTransform.mockResolvedValue(undefined);

    const { result } = renderHook(() => useToggleTransform("ds-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ transformId: "t-1", isActive: false });
    });

    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached?.transforms[0].status).toBe("disabled");
  });

  it("optimistically toggles transform to enabled", async () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({ id: "t-1", status: "disabled" });
    const dataset = makeDataset({ transforms: [t1] });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockToggleTransform.mockResolvedValue(undefined);

    const { result } = renderHook(() => useToggleTransform("ds-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ transformId: "t-1", isActive: true });
    });

    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached?.transforms[0].status).toBe("enabled");
  });

  it("rolls back on error", async () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({ id: "t-1", status: "enabled" });
    const dataset = makeDataset({ transforms: [t1] });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockToggleTransform.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useToggleTransform("ds-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ transformId: "t-1", isActive: false });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
      expect(cached?.transforms[0].status).toBe("enabled");
    });
  });
});

describe("useTransforms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty transforms when dataset is null", () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useTransforms({ dataset: null }),
      { wrapper },
    );

    expect(result.current.transforms).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns transforms from dataset", () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({ id: "t-1" });
    const dataset = makeDataset({ transforms: [t1] });

    const { result } = renderHook(
      () => useTransforms({ dataset }),
      { wrapper },
    );

    expect(result.current.transforms).toHaveLength(1);
    expect(result.current.transforms[0].id).toBe("t-1");
  });

  it("saveTransform returns false when dataset is null", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useTransforms({ dataset: null }),
      { wrapper },
    );

    let success: boolean;
    await act(async () => {
      success = await result.current.saveTransform({ name: "X" });
    });

    expect(success!).toBe(false);
    expect(mockCreateTransform).not.toHaveBeenCalled();
  });

  it("saveTransform returns true on success", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockCreateTransform.mockResolvedValue(makeTransform());

    const { result } = renderHook(
      () => useTransforms({ dataset }),
      { wrapper },
    );

    let success: boolean;
    await act(async () => {
      success = await result.current.saveTransform({ name: "New" });
    });

    expect(success!).toBe(true);
  });

  it("saveTransform returns false on failure", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockCreateTransform.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(
      () => useTransforms({ dataset }),
      { wrapper },
    );

    let success: boolean;
    await act(async () => {
      success = await result.current.saveTransform({ name: "Bad" });
    });

    expect(success!).toBe(false);
  });

  it("removeTransform returns false when dataset is null", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useTransforms({ dataset: null }),
      { wrapper },
    );

    let success: boolean;
    await act(async () => {
      success = await result.current.removeTransform("t-1");
    });

    expect(success!).toBe(false);
  });

  it("toggleTransform returns false when dataset is null", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useTransforms({ dataset: null }),
      { wrapper },
    );

    let success: boolean;
    await act(async () => {
      success = await result.current.toggleTransform("t-1", true);
    });

    expect(success!).toBe(false);
  });

  it("toggleTransform calls onFiltersChanged after success", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset({ transforms: [makeTransform()] });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockToggleTransform.mockResolvedValue(undefined);
    const onFiltersChanged = vi.fn();

    const { result } = renderHook(
      () => useTransforms({ dataset, onFiltersChanged }),
      { wrapper },
    );

    await act(async () => {
      await result.current.toggleTransform("t-1", false);
    });

    // onFiltersChanged is called via setTimeout(..., 0)
    await waitFor(() => {
      expect(onFiltersChanged).toHaveBeenCalledOnce();
    });
  });

  it("auto-applies active filters on mount", () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({
      id: "t-1",
      status: "enabled",
      transform_type: "filter",
      condition_json: { type: "group", children1: {} } as any,
    });
    const dataset = makeDataset({ transforms: [t1] });

    const onFilterApply = vi.fn();

    renderHook(
      () => useTransforms({ dataset, onFilterApply }),
      { wrapper },
    );

    expect(onFilterApply).toHaveBeenCalled();
  });

  it("skips auto-apply when autoApplyActive is false", () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({
      status: "enabled",
      condition_json: { type: "group", children1: {} } as any,
    });
    const dataset = makeDataset({ transforms: [t1] });

    const onFilterApply = vi.fn();

    renderHook(
      () => useTransforms({ dataset, onFilterApply, autoApplyActive: false }),
      { wrapper },
    );

    expect(onFilterApply).not.toHaveBeenCalled();
  });

  it("skips disabled transforms in auto-apply", () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({
      status: "disabled",
      condition_json: { type: "group", children1: {} } as any,
    });
    const dataset = makeDataset({ transforms: [t1] });

    const onFilterApply = vi.fn();

    renderHook(
      () => useTransforms({ dataset, onFilterApply }),
      { wrapper },
    );

    // Called with empty filters since the only transform is disabled
    expect(onFilterApply).toHaveBeenCalledWith([]);
  });

  it("applyTransform does nothing without onFilterApply", () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();

    const { result } = renderHook(
      () => useTransforms({ dataset }),
      { wrapper },
    );

    // Should not throw
    act(() => {
      result.current.applyTransform(makeTransform());
    });
  });

  it("applyTransform ignores non-filter transforms", () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    const onFilterApply = vi.fn();

    const { result } = renderHook(
      () => useTransforms({ dataset, onFilterApply }),
      { wrapper },
    );

    // Reset calls from auto-apply
    onFilterApply.mockClear();

    act(() => {
      result.current.applyTransform(
        makeTransform({ transform_type: "column_transform" }),
      );
    });

    expect(onFilterApply).not.toHaveBeenCalled();
  });

  it("applyTransform ignores filter without condition_json", () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    const onFilterApply = vi.fn();

    const { result } = renderHook(
      () => useTransforms({ dataset, onFilterApply }),
      { wrapper },
    );

    onFilterApply.mockClear();

    act(() => {
      result.current.applyTransform(
        makeTransform({ transform_type: "filter", condition_json: null }),
      );
    });

    expect(onFilterApply).not.toHaveBeenCalled();
  });

  it("applyTransform calls onFilterApply with merged filters", () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    const onFilterApply = vi.fn();

    const { result } = renderHook(
      () => useTransforms({ dataset, onFilterApply }),
      { wrapper },
    );

    onFilterApply.mockClear();

    act(() => {
      result.current.applyTransform(
        makeTransform({
          id: "t-1",
          transform_type: "filter",
          condition_json: { type: "group", children1: {} } as any,
        }),
      );
    });

    expect(onFilterApply).toHaveBeenCalledWith(expect.any(Function));
  });

  it("applyActiveTransforms recomputes all active filters", () => {
    const wrapper = createWrapper();
    const t1 = makeTransform({
      id: "t-1",
      status: "enabled",
      condition_json: { type: "group", children1: {} } as any,
    });
    const t2 = makeTransform({
      id: "t-2",
      status: "disabled",
      condition_json: { type: "group", children1: {} } as any,
    });
    const dataset = makeDataset({ transforms: [t1, t2] });

    const onFilterApply = vi.fn();

    const { result } = renderHook(
      () => useTransforms({ dataset, onFilterApply }),
      { wrapper },
    );

    onFilterApply.mockClear();

    act(() => {
      result.current.applyActiveTransforms();
    });

    // Should be called with filters from only the enabled transform
    expect(onFilterApply).toHaveBeenCalledOnce();
  });

  it("reports loading when any mutation is pending", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    // Never resolve to keep pending
    let resolveCreate: (v: Transform) => void;
    mockCreateTransform.mockImplementation(
      () => new Promise<Transform>((r) => { resolveCreate = r; }),
    );

    const { result } = renderHook(
      () => useTransforms({ dataset }),
      { wrapper },
    );

    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.saveTransform({ name: "X" });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // Resolve to clean up
    await act(async () => {
      resolveCreate!(makeTransform());
    });
  });

  it("reports error from failed mutation", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockCreateTransform.mockRejectedValue(new Error("Something broke"));

    const { result } = renderHook(
      () => useTransforms({ dataset }),
      { wrapper },
    );

    await act(async () => {
      await result.current.saveTransform({ name: "Bad" });
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Something broke");
    });
  });
});
