import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DatasetSparse } from "@/dataCatalog";

// --- Mocks ---

const { mockUpdateDataset, mockArchiveDataset, mockRestoreDataset } = vi.hoisted(
  () => ({
    mockUpdateDataset: vi.fn(),
    mockArchiveDataset: vi.fn(),
    mockRestoreDataset: vi.fn(),
  }),
);

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      updateDataset: mockUpdateDataset,
      archiveDataset: mockArchiveDataset,
      restoreDataset: mockRestoreDataset,
    }),
  };
});

import { datasetKeys } from "../queryKeys";
import {
  useArchiveDataset,
  useRenameDataset,
  useRestoreDataset,
  useUpdateDatasetDisplayName,
} from "../useDatasetMutations";

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

describe("useUpdateDatasetDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically updates the display name in the detail cache", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset({ display_name: null });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockUpdateDataset.mockResolvedValue({ ...dataset, display_name: "Pretty" });

    const { result } = renderHook(() => useUpdateDatasetDisplayName("p-1"), {
      wrapper,
    });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1", displayName: "Pretty" });
    });

    const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
    expect(cached?.display_name).toBe("Pretty");
    // The underlying name is left untouched by a display-name edit.
    expect(cached?.name).toBe("Original Name");
  });

  it("optimistically updates the display name in the list cache", async () => {
    const wrapper = createWrapper();
    const sparse = makeDatasetSparse({ display_name: null });
    queryClient.setQueryData(datasetKeys.list("p-1"), [sparse]);

    mockUpdateDataset.mockResolvedValue({ display_name: "Pretty" });

    const { result } = renderHook(() => useUpdateDatasetDisplayName("p-1"), {
      wrapper,
    });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1", displayName: "Pretty" });
    });

    const cached = queryClient.getQueryData<DatasetSparse[]>(
      datasetKeys.list("p-1"),
    );
    expect(cached?.[0].display_name).toBe("Pretty");
  });

  it("rolls back the detail cache on error", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset({ display_name: "Before" });
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);

    mockUpdateDataset.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useUpdateDatasetDisplayName("p-1"), {
      wrapper,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ datasetId: "ds-1", displayName: "After" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Dataset>(datasetKeys.detail("ds-1"));
      expect(cached?.display_name).toBe("Before");
    });
  });

  it("calls the API with only the display_name", async () => {
    const wrapper = createWrapper();
    mockUpdateDataset.mockResolvedValue({ display_name: "Pretty" });

    const { result } = renderHook(() => useUpdateDatasetDisplayName("p-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1", displayName: "Pretty" });
    });

    expect(mockUpdateDataset).toHaveBeenCalledWith("ds-1", {
      display_name: "Pretty",
    });
  });

  it("invalidates detail and list queries on settle", async () => {
    const wrapper = createWrapper();
    const dataset = makeDataset();
    queryClient.setQueryData(datasetKeys.detail("ds-1"), dataset);
    queryClient.setQueryData(datasetKeys.list("p-1"), [makeDatasetSparse()]);

    mockUpdateDataset.mockResolvedValue({ ...dataset, display_name: "Pretty" });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateDatasetDisplayName("p-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1", displayName: "Pretty" });
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

describe("useArchiveDataset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically removes the dataset from the live list cache", async () => {
    const wrapper = createWrapper();
    const live1 = makeDatasetSparse({ id: "ds-1", name: "One" });
    const live2 = makeDatasetSparse({ id: "ds-2", name: "Two" });
    queryClient.setQueryData(datasetKeys.list("p-1"), [live1, live2]);

    mockArchiveDataset.mockResolvedValue({ ...live1, archived_at: "2026-06-01T00:00:00Z" });

    const { result } = renderHook(() => useArchiveDataset("p-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1" });
    });

    const cached = queryClient.getQueryData<DatasetSparse[]>(datasetKeys.list("p-1"));
    expect(cached?.map((d) => d.id)).toEqual(["ds-2"]);
  });

  it("calls the API with the dataset id", async () => {
    const wrapper = createWrapper();
    mockArchiveDataset.mockResolvedValue({ id: "ds-1" });

    const { result } = renderHook(() => useArchiveDataset("p-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1" });
    });

    expect(mockArchiveDataset).toHaveBeenCalledWith("ds-1");
  });

  it("rolls back the live list cache on error", async () => {
    const wrapper = createWrapper();
    const live1 = makeDatasetSparse({ id: "ds-1", name: "One" });
    queryClient.setQueryData(datasetKeys.list("p-1"), [live1]);

    mockArchiveDataset.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useArchiveDataset("p-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ datasetId: "ds-1" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<DatasetSparse[]>(datasetKeys.list("p-1"));
      expect(cached?.map((d) => d.id)).toEqual(["ds-1"]);
    });
  });

  it("invalidates the live list, the archived list, and the detail on settle", async () => {
    const wrapper = createWrapper();
    queryClient.setQueryData(datasetKeys.list("p-1"), [makeDatasetSparse()]);
    mockArchiveDataset.mockResolvedValue({ id: "ds-1" });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useArchiveDataset("p-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1" });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.list("p-1") }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.archived("p-1") }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.detail("ds-1") }),
      );
    });
  });
});

describe("useRestoreDataset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically removes the dataset from the archived list cache", async () => {
    const wrapper = createWrapper();
    const archived1 = makeDatasetSparse({
      id: "ds-1",
      name: "One",
      archived_at: "2026-06-01T00:00:00Z",
    });
    queryClient.setQueryData(datasetKeys.archived("p-1"), [archived1]);

    mockRestoreDataset.mockResolvedValue({ ...archived1, archived_at: null });

    const { result } = renderHook(() => useRestoreDataset("p-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ datasetId: "ds-1" });
    });

    const cached = queryClient.getQueryData<DatasetSparse[]>(
      datasetKeys.archived("p-1"),
    );
    expect(cached?.map((d) => d.id)).toEqual([]);
  });

  it("calls the API with the dataset id", async () => {
    const wrapper = createWrapper();
    mockRestoreDataset.mockResolvedValue({ id: "ds-1" });

    const { result } = renderHook(() => useRestoreDataset("p-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1" });
    });

    expect(mockRestoreDataset).toHaveBeenCalledWith("ds-1");
  });

  it("invalidates the live list, the archived list, and the detail on settle", async () => {
    const wrapper = createWrapper();
    queryClient.setQueryData(datasetKeys.archived("p-1"), [
      makeDatasetSparse({ archived_at: "2026-06-01T00:00:00Z" }),
    ]);
    mockRestoreDataset.mockResolvedValue({ id: "ds-1" });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRestoreDataset("p-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ datasetId: "ds-1" });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.list("p-1") }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: datasetKeys.archived("p-1") }),
      );
    });
  });
});
