import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@/dataCatalog";

// --- Mocks ---

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      createSession: mockCreateSession,
    }),
  };
});

import { sessionKeys } from "../queryKeys";
import { useCreateSession } from "../useCreateSession";

// --- Helpers ---

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    memory_id: "mem-1",
    stream_thread_id: "thread-1",
    owner_id: "user-1",
    title: null,
    org_id: "org-1",
    created_at: "2025-01-01T00:00:00Z",
    last_active_at: "2025-01-01T00:00:00Z",
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

describe("useCreateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a session and returns it", async () => {
    const session = makeSession();
    mockCreateSession.mockResolvedValue(session);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreateSession("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(session);
    });
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1");
  });

  it("invalidates session list on success", async () => {
    const session = makeSession();
    mockCreateSession.mockResolvedValue(session);

    const wrapper = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSession("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: sessionKeys.list("proj-1"),
        }),
      );
    });
  });

  it("propagates errors from the API", async () => {
    mockCreateSession.mockRejectedValue(new Error("forbidden"));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreateSession("proj-1"), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("forbidden");
  });
});
