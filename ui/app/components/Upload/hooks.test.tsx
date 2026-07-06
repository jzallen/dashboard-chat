// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogSource, PartialCatalogSource } from "../../catalog";
import type { StateProxy } from "../../lib/state-proxy";
import { StateProxyProvider } from "../../lib/StateProxyProvider";
import { catalog, installCatalogForTest, selectProject } from "../useCatalog";
import { useUpload } from "./hooks";

afterEach(() => vi.restoreAllMocks());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A minimal complete fallback the test catalog seeds from. */
function fallback(): CatalogSource {
  const empty = [] as unknown;
  return {
    getProjects: () => Promise.resolve(empty as never),
    getCurrentProject: () => Promise.resolve({ id: "p1", name: "P1", description: "" }),
    getOrg: () => Promise.resolve({} as never),
    getRecents: () => Promise.resolve(empty as never),
    getAllChats: () => Promise.resolve(empty as never),
    getNodes: () => Promise.resolve({}),
    getEdges: () => Promise.resolve([]),
    getAudit: () => Promise.resolve({}),
    getChatScript: () => Promise.resolve({} as never),
    getDbtFiles: () => Promise.resolve(empty as never),
  };
}

/** A backend primary backing the source-upload saga ports. */
function sagaPrimary() {
  return {
    getCurrentProject: () =>
      Promise.resolve({ id: "p1", name: "P1", description: "" }),
    getNodes: () => Promise.resolve({}),
    getEdges: () => Promise.resolve([]),
    getAudit: () => Promise.resolve({}),
    createSource: vi.fn(async () => ({ id: "src.real" })),
    requestUpload: vi.fn(async () => ({
      uploadId: "up.1",
      putUrl: "https://minio.local/k?sig=x",
      storageKey: "k",
    })),
    putToStorage: vi.fn(async () => undefined),
    processUpload: vi.fn(async () => ({ datasetId: "ds.real" })),
    invalidateScope: vi.fn(),
  } satisfies PartialCatalogSource;
}

/** A StateProxy test double recording the events posted through it. */
function recordingProxy() {
  const events: string[] = [];
  const proxy = {
    id: "test",
    sessionId: "test",
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    send: vi.fn(),
    postEvent: vi.fn(async (e: { type: string }) => {
      events.push(e.type);
      return {} as never;
    }),
  } as unknown as StateProxy;
  return { proxy, events };
}

function wrapper(proxy: StateProxy) {
  return ({ children }: { children: ReactNode }) => (
    <StateProxyProvider proxy={proxy}>{children}</StateProxyProvider>
  );
}

describe("useUpload — createSource (slice-4 saga)", () => {
  it("drives catalog.createSourceFromUpload, posts ordered events, and flashes the linked dataset", async () => {
    const primary = sagaPrimary();
    await installCatalogForTest(primary, fallback());
    await selectProject("p1");
    await flush();

    const { proxy, events } = recordingProxy();
    const flash = vi.fn();
    const { result } = renderHook(() => useUpload(flash), {
      wrapper: wrapper(proxy),
    });

    const file = new File(["a,b\n1,2\n"], "orders.csv", { type: "text/csv" });
    await result.current.createSource({ file, name: "orders_csv" });

    expect(primary.createSource).toHaveBeenCalledWith("orders_csv");
    expect(primary.putToStorage).toHaveBeenCalled();
    expect(events).toEqual([
      "source_create_requested",
      "source_created",
      "source_upload_started",
      "source_upload_processed",
    ]);
    // The linked dataset is flashed so the canvas pops it.
    expect(flash).toHaveBeenCalledWith("ds.real");
  });

  it("does nothing when no file was chosen", async () => {
    await installCatalogForTest(sagaPrimary(), fallback());
    const { proxy, events } = recordingProxy();
    const { result } = renderHook(() => useUpload(vi.fn()), {
      wrapper: wrapper(proxy),
    });

    await result.current.createSource({ file: null, name: "x" });
    expect(events).toEqual([]);
  });

  it("adds to an EXISTING source (skips createSource) when the modal opened on a source node", async () => {
    const primary = sagaPrimary();
    await installCatalogForTest(primary, fallback());
    await selectProject("p1");
    await flush();

    const { proxy, events } = recordingProxy();
    const flash = vi.fn();
    const { result } = renderHook(() => useUpload(flash), {
      wrapper: wrapper(proxy),
    });

    // Open the modal on an EXISTING source node (the double-click affordance).
    act(() =>
      result.current.openUpload({
        id: "src.real",
        label: "Patients",
        sub: "source",
        layer: "source",
        schema: [],
        files: [],
      }),
    );

    const file = new File(["a,b\n3,4\n"], "more.csv", { type: "text/csv" });
    await result.current.createSource({ file, name: "more_csv" });

    // The add path uploads to the existing source id WITHOUT creating a source.
    expect(primary.createSource).not.toHaveBeenCalled();
    expect(primary.requestUpload).toHaveBeenCalledWith("src.real", file);
    expect(primary.processUpload).toHaveBeenCalled();
    // No source_create_requested / source_created on the add path.
    expect(events).toEqual([
      "source_upload_started",
      "source_upload_processed",
    ]);
    expect(flash).toHaveBeenCalledWith("ds.real");
  });

  it("exposes the schema-mismatch detail for the recovery UX when the add path 422s", async () => {
    const primary = sagaPrimary();
    primary.processUpload = vi.fn(async () => {
      // Mirror the ApiError the gateway client throws on a 422 from /process.
      const { ApiError } = await import("../../lib/api-error");
      throw new ApiError(
        422,
        {
          errors: [
            {
              title: "Schema Mismatch",
              detail: { missing: ["active"], extra: ["email"], type_mismatch: [] },
            },
          ],
        },
        "POST .../process failed with status 422",
      );
    });
    await installCatalogForTest(primary, fallback());
    await selectProject("p1");
    await flush();

    const { proxy } = recordingProxy();
    const { result } = renderHook(() => useUpload(vi.fn()), {
      wrapper: wrapper(proxy),
    });

    act(() =>
      result.current.openUpload({
        id: "src.real",
        label: "Patients",
        sub: "source",
        layer: "source",
        schema: [],
        files: [],
      }),
    );

    const file = new File(["x"], "bad.csv", { type: "text/csv" });
    await result.current.createSource({ file, name: "bad" });
    await flush();

    expect(result.current.mismatch).toEqual({
      missing: ["active"],
      extra: ["email"],
      type_mismatch: [],
    });
  });

  it("surfaces a saga failure (does not flash) when processing rejects", async () => {
    const primary = sagaPrimary();
    primary.processUpload = vi.fn(async () => {
      throw new Error("409 schema mismatch");
    });
    await installCatalogForTest(primary, fallback());
    await selectProject("p1");
    await flush();

    const { proxy, events } = recordingProxy();
    const flash = vi.fn();
    const { result } = renderHook(() => useUpload(flash), {
      wrapper: wrapper(proxy),
    });

    const file = new File(["x"], "x.csv", { type: "text/csv" });
    await result.current.createSource({ file, name: "x" });

    expect(events).toContain("source_upload_failed");
    expect(flash).not.toHaveBeenCalled();
    // catalog is still usable (no crash).
    expect(catalog.listNodes()).toBeDefined();
  });
});
