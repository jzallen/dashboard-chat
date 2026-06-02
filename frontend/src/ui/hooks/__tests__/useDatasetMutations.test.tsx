import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DatasetSparse } from "@/dataCatalog";

// --- Mocks ---

const { mockUpdateDataset } = vi.hoisted(() => ({
  mockUpdateDataset: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      updateDataset: mockUpdateDataset,
    }),
  };
});

import { datasetKeys } from "../queryKeys";
import { useRenameDataset } from "../useDatasetMutations";

// --- Helpers ---

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "ds-1",
    project_id: "p-1",
    name: "Original Name",
    description: null,
    schema_config: { fields: {} },
    partition_fields: [],
    transforms: [],
    preview_rows: [],
    column_profiles: null,
    ...overrides,
  };
}

function makeDatasetSparse(overrides: Partial<DatasetSparse> = {}): DatasetSparse {
  return {
    id: "ds-1",
    name: "Original Name",
    link: "/api/datasets/ds-1",
    description: null,
    schema_config: { fields: {} },
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

describe("useRenameDataset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically updates detail cache", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockUpdateDataset.mockResolvedValue({ ...dataset, name: "New Name" });

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1", name: "New Name" });
    });

    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached?.name).toBe("New Name");
  });

  it("optimistically updates list cache", async () => {
    const wrapper = createWrapper();
    const sparse = makeDatasetSparse();
    queryClient.setQueryData(datasetKeys.list("p-1"), [sparse]);

    mockUpdateDataset.mockResolvedValue({ name: "New Name" });

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1", name: "New Name" });
    });

    const cached = queryClient.getQueryData<DatasetSparse[]>(datasetKeys.list("p-1"));
    expect(cached?.[0].name).toBe("New Name");
  });

  it("does not update list entries with different id", async () => {
    const wrapper = createWrapper();
    const sparse1 = makeDatasetSparse({ id: "ds-1", name: "One" });
    const sparse2 = makeDatasetSparse({ id: "ds-2", name: "Two" });
    queryClient.setQueryData(datasetKeys.list("p-1"), [sparse1, sparse2]);

    mockUpdateDataset.mockResolvedValue({ name: "Renamed" });

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1", name: "Renamed" });
    });

    const cached = queryClient.getQueryData<DatasetSparse[]>(datasetKeys.list("p-1"));
    expect(cached?.[0].name).toBe("Renamed");
    expect(cached?.[1].name).toBe("Two");
  });

  it("rolls back detail cache on error", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset({ name: "Original" });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockUpdateDataset.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ datasetId: "ds-1", name: "Bad" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
      expect(cached?.name).toBe("Original");
    });
  });

  it("rolls back list cache on error", async () => {
    const wrapper = createWrapper();
    const sparse = makeDatasetSparse({ name: "Original" });
    queryClient.setQueryData(datasetKeys.list("p-1"), [sparse]);

    mockUpdateDataset.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ datasetId: "ds-1", name: "Bad" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<DatasetSparse[]>(datasetKeys.list("p-1"));
      expect(cached?.[0].name).toBe("Original");
    });
  });

  it("calls API with correct arguments", async () => {
    const wrapper = createWrapper();
    mockUpdateDataset.mockResolvedValue({ name: "New" });

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1", name: "New" });
    });

    expect(mockUpdateDataset).toHaveBeenCalledWith("ds-1", { name: "New" });
  });

  it("invalidates queries on settle", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);
    queryClient.setQueryData(datasetKeys.list("p-1"), [makeDatasetSparse()]);

    mockUpdateDataset.mockResolvedValue({ ...dataset, name: "New" });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRenameDataset("p-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1", name: "New" });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.detail("ds-1") }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.list("p-1") }),
      );
    });
  });
});
