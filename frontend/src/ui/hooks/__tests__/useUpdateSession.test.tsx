import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session, SessionsPage } from "@/dataCatalog";

// --- Mocks ---

const { mockUpdateSession } = vi.hoisted(() => ({
  mockUpdateSession: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      updateSession: mockUpdateSession,
    }),
  };
});

import { sessionKeys } from "../queryKeys";
import { useUpdateSession } from "../useUpdateSession";

// --- Helpers ---

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    memory_id: "mem-1",
    stream_thread_id: "thread-1",
    owner_id: "user-1",
    title: "Old title",
    org_id: "org-1",
    created_at: "2025-01-01T00:00:00Z",
    last_active_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSessionsPage(sessions: Session[]): SessionsPage {
  return {
    data: sessions,
    meta: { next_cursor: null, has_more: false },
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

describe("useUpdateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls API with correct arguments", async () => {
    const updated = makeSession({ title: "New title" });
    mockUpdateSession.mockResolvedValue(updated);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useUpdateSession("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ sessionId: "sess-1", title: "New title" });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith("proj-1", "sess-1", { title: "New title" });
  });

  it("optimistically updates session list cache", async () => {
    const wrapper = createWrapper();
    const session = makeSession({ title: "Old title" });
    const page = makeSessionsPage([session]);

    // Seed infinite query cache
    queryClient.setQueryData(sessionKeys.list("proj-1"), {
      pages: [page],
      pageParams: [undefined],
    });

    mockUpdateSession.mockResolvedValue(makeSession({ title: "New title" }));

    const { result } = renderHook(() => useUpdateSession("proj-1"), { wrapper });

    await act(async () => {
      result.current.mutate({ sessionId: "sess-1", title: "New title" });
    });

    // Check optimistic update applied
    const cached = queryClient.getQueryData<{
      pages: SessionsPage[];
      pageParams: unknown[];
    }>(sessionKeys.list("proj-1"));
    expect(cached?.pages[0].data[0].title).toBe("New title");
  });

  it("rolls back on error", async () => {
    const wrapper = createWrapper();
    const session = makeSession({ title: "Original" });
    const page = makeSessionsPage([session]);

    queryClient.setQueryData(sessionKeys.list("proj-1"), {
      pages: [page],
      pageParams: [undefined],
    });

    mockUpdateSession.mockRejectedValue(new Error("forbidden"));

    const { result } = renderHook(() => useUpdateSession("proj-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ sessionId: "sess-1", title: "Bad" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<{
        pages: SessionsPage[];
        pageParams: unknown[];
      }>(sessionKeys.list("proj-1"));
      expect(cached?.pages[0].data[0].title).toBe("Original");
    });
  });

  it("invalidates session list on settle", async () => {
    const wrapper = createWrapper();
    mockUpdateSession.mockResolvedValue(makeSession({ title: "New" }));

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSession("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ sessionId: "sess-1", title: "New" });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: sessionKeys.list("proj-1"),
        }),
      );
    });
  });
});
