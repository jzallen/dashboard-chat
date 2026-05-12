import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectMemory } from "@/dataCatalog";

// --- Mocks ---

const { mockGetProjectMemory } = vi.hoisted(() => ({
  mockGetProjectMemory: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      getProjectMemory: mockGetProjectMemory,
    }),
  };
});

import { memoryKeys } from "../queryKeys";
import { useProjectMemory } from "../useProjectMemory";

// --- Helpers ---

function makeMemory(overrides: Partial<ProjectMemory> = {}): ProjectMemory {
  return {
    id: "mem-1",
    project_id: "proj-1",
    org_id: "org-1",
    stream_channel_id: "proj_abc123_def456",
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

let queryClient: QueryClient;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// --- Tests ---

describe("useProjectMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns project memory", async () => {
    const memory = makeMemory();
    mockGetProjectMemory.mockResolvedValue(memory);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useProjectMemory("proj-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(memory);
    expect(mockGetProjectMemory).toHaveBeenCalledWith("proj-1");
  });

  it("does not fetch when projectId is undefined", () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProjectMemory(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGetProjectMemory).not.toHaveBeenCalled();
  });

  it("uses the correct query key", async () => {
    const memory = makeMemory();
    mockGetProjectMemory.mockResolvedValue(memory);

    const wrapper = createWrapper();
    renderHook(() => useProjectMemory("proj-1"), { wrapper });

    await waitFor(() => {
      const cached = queryClient.getQueryData(memoryKeys.detail("proj-1"));
      expect(cached).toEqual(memory);
    });
  });
});
