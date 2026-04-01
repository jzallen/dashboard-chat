import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionsPage } from "@/dataCatalog";

// --- Mocks ---

const { mockListSessions } = vi.hoisted(() => ({
  mockListSessions: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      listSessions: mockListSessions,
    }),
  };
});

import { useSessions } from "../useSessions";

// --- Helpers ---

function makeSessionsPage(overrides: Partial<SessionsPage> = {}): SessionsPage {
  return {
    data: [
      {
        id: "sess-1",
        memory_id: "mem-1",
        stream_thread_id: "thread-1",
        owner_id: "user-1",
        title: "First session",
        org_id: "org-1",
        created_at: "2025-01-01T00:00:00Z",
        last_active_at: "2025-01-01T12:00:00Z",
      },
    ],
    meta: { next_cursor: null, has_more: false },
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

describe("useSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns sessions for a project", async () => {
    const page = makeSessionsPage();
    mockListSessions.mockResolvedValue(page);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useSessions("proj-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.pages[0].data).toHaveLength(1);
    expect(result.current.data?.pages[0].data[0].title).toBe("First session");
  });

  it("does not fetch when projectId is undefined", () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSessions(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockListSessions).not.toHaveBeenCalled();
  });

  it("reports hasNextPage when meta.has_more is true", async () => {
    const page = makeSessionsPage({
      meta: { next_cursor: "cursor-abc", has_more: true },
    });
    mockListSessions.mockResolvedValue(page);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useSessions("proj-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.hasNextPage).toBe(true);
  });

  it("reports no next page when meta.has_more is false", async () => {
    const page = makeSessionsPage({
      meta: { next_cursor: null, has_more: false },
    });
    mockListSessions.mockResolvedValue(page);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useSessions("proj-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.hasNextPage).toBe(false);
  });
});
