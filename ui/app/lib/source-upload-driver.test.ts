import { describe, expect, it, vi } from "vitest";

import { createSourceUploadDriver } from "./source-upload-driver";

/** A no-op logger matching the createLogger surface the driver consumes. */
const noopLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof createSourceUploadDriver>[0]["log"];

/** A happy-path catalog port double — each step resolves the next id. */
function happyCatalog() {
  return {
    createSource: vi.fn(async () => ({ id: "src.1" })),
    requestUpload: vi.fn(async () => ({
      uploadId: "up.1",
      putUrl: "https://minio.local/k?sig=x",
      storageKey: "uploads/p1/src.1/up.1/orders.csv",
    })),
    putToStorage: vi.fn(async () => undefined),
    processUpload: vi.fn(async () => ({ datasetId: "ds.1" })),
    revalidate: vi.fn(async () => undefined),
  };
}

/** A report sink that records the ordered event types it received. */
function recordingReport() {
  const events: string[] = [];
  const report = vi.fn(async (event: { type: string }) => {
    events.push(event.type);
    return {} as never;
  });
  return { report, events };
}

const file = new File(["a,b\n1,2\n"], "orders.csv", { type: "text/csv" });

describe("sourceUploadDriver — happy path", () => {
  it("adds an optimistic node then drives create→upload→process in order", async () => {
    const catalog = happyCatalog();
    const { report, events } = recordingReport();
    const addOptimistic = vi.fn();
    const removeOptimistic = vi.fn();

    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic,
      removeOptimistic,
      log: noopLog,
      newTempId: () => "tmp.abc",
    });

    const result = await driver.createSourceFromUpload({
      file,
      name: "orders_csv",
      projectId: "p1",
    });

    // Optimistic node added with the temp id BEFORE any backend call.
    expect(addOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tmp.abc", layer: "source", label: "orders_csv" }),
    );
    expect(removeOptimistic).not.toHaveBeenCalled();

    // Backend saga, in order.
    expect(catalog.createSource).toHaveBeenCalledWith("orders_csv");
    expect(catalog.requestUpload).toHaveBeenCalledWith("src.1", file);
    expect(catalog.putToStorage).toHaveBeenCalledWith(
      "https://minio.local/k?sig=x",
      file,
    );
    expect(catalog.processUpload).toHaveBeenCalledWith("src.1", "up.1");
    expect(catalog.revalidate).toHaveBeenCalled();

    // The ordered past-tense reports to ui-state.
    expect(events).toEqual([
      "source_create_requested",
      "source_created",
      "source_upload_started",
      "source_upload_processed",
    ]);

    expect(result).toEqual({ datasetId: "ds.1", tempNodeId: "tmp.abc" });
  });

  it("reports source_create_requested with the temp id + project id", async () => {
    const catalog = happyCatalog();
    const report = vi.fn(async () => ({}) as never);
    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic: vi.fn(),
      removeOptimistic: vi.fn(),
      log: noopLog,
      newTempId: () => "tmp.abc",
    });

    await driver.createSourceFromUpload({ file, name: "x", projectId: "p1" });

    expect(report).toHaveBeenCalledWith({
      type: "source_create_requested",
      payload: { temp_node_id: "tmp.abc", project_id: "p1" },
    });
    expect(report).toHaveBeenCalledWith({
      type: "source_created",
      payload: { source_id: "src.1" },
    });
    expect(report).toHaveBeenCalledWith({
      type: "source_upload_started",
      payload: { upload_id: "up.1" },
    });
    expect(report).toHaveBeenCalledWith({
      type: "source_upload_processed",
      payload: { dataset_id: "ds.1" },
    });
  });
});

describe("sourceUploadDriver — add to an existing source (slice 5)", () => {
  it("skips createSource and uploads to the given source id, in order, with no optimistic node", async () => {
    const catalog = happyCatalog();
    const { report, events } = recordingReport();
    const addOptimistic = vi.fn();
    const removeOptimistic = vi.fn();

    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic,
      removeOptimistic,
      log: noopLog,
      newTempId: () => "tmp.unused",
    });

    const result = await driver.addUploadToSource({
      file,
      sourceId: "src.existing",
      projectId: "p1",
    });

    // No new optimistic node — the source already exists on the canvas.
    expect(addOptimistic).not.toHaveBeenCalled();
    expect(removeOptimistic).not.toHaveBeenCalled();
    // createSource is NOT called; the upload targets the existing source id.
    expect(catalog.createSource).not.toHaveBeenCalled();
    expect(catalog.requestUpload).toHaveBeenCalledWith("src.existing", file);
    expect(catalog.putToStorage).toHaveBeenCalledWith(
      "https://minio.local/k?sig=x",
      file,
    );
    expect(catalog.processUpload).toHaveBeenCalledWith("src.existing", "up.1");
    expect(catalog.revalidate).toHaveBeenCalled();

    // No source_create_requested / source_created for the add path.
    expect(events).toEqual([
      "source_upload_started",
      "source_upload_processed",
    ]);
    expect(result).toEqual({ datasetId: "ds.1" });
  });

  it("reports source_upload_failed on a process rejection but does NOT touch optimistic nodes", async () => {
    const catalog = happyCatalog();
    catalog.processUpload = vi.fn(async () => {
      throw new Error("422 schema mismatch");
    });
    const { report, events } = recordingReport();
    const removeOptimistic = vi.fn();

    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic: vi.fn(),
      removeOptimistic,
      log: noopLog,
      newTempId: () => "tmp.unused",
    });

    await expect(
      driver.addUploadToSource({ file, sourceId: "src.existing", projectId: "p1" }),
    ).rejects.toThrow();

    // The existing source node must NOT be rolled back — it really exists.
    expect(removeOptimistic).not.toHaveBeenCalled();
    expect(events).toContain("source_upload_failed");
    expect(events).not.toContain("source_upload_processed");
    expect(catalog.revalidate).not.toHaveBeenCalled();
  });

  it("re-throws the original error so the surface can read its 422 mismatch body", async () => {
    const catalog = happyCatalog();
    const mismatchError = {
      status: 422,
      body: {
        errors: [
          {
            title: "Schema Mismatch",
            detail: { missing: ["active"], extra: ["email"], type_mismatch: [] },
          },
        ],
      },
      message: "POST .../process failed with status 422",
    };
    catalog.processUpload = vi.fn(async () => {
      throw mismatchError;
    });
    const { report } = recordingReport();

    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic: vi.fn(),
      removeOptimistic: vi.fn(),
      log: noopLog,
      newTempId: () => "tmp.unused",
    });

    // The driver re-throws the SAME error object (so the hook can read .body
    // for the mismatch columns); the failure report carries a reason summary.
    await expect(
      driver.addUploadToSource({ file, sourceId: "src.existing", projectId: "p1" }),
    ).rejects.toBe(mismatchError);

    const failure = report.mock.calls
      .map((c) => c[0] as { type: string; payload?: { reason?: string } })
      .find((e) => e.type === "source_upload_failed");
    expect(failure?.payload?.reason).toContain("422");
  });
});

describe("sourceUploadDriver — failure rollback", () => {
  it("rolls back the optimistic node and reports source_upload_failed when process 409s", async () => {
    const catalog = happyCatalog();
    catalog.processUpload = vi.fn(async () => {
      throw new Error("409 schema mismatch");
    });
    const { report, events } = recordingReport();
    const removeOptimistic = vi.fn();

    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic: vi.fn(),
      removeOptimistic,
      log: noopLog,
      newTempId: () => "tmp.abc",
    });

    await expect(
      driver.createSourceFromUpload({ file, name: "x", projectId: "p1" }),
    ).rejects.toThrow();

    // The optimistic node is removed (rolled back).
    expect(removeOptimistic).toHaveBeenCalledWith("tmp.abc");
    // The last report is the failure (never source_upload_processed).
    expect(events).toContain("source_upload_failed");
    expect(events).not.toContain("source_upload_processed");
    // The failure carries a reason.
    const failure = report.mock.calls
      .map((c) => c[0] as { type: string; payload?: { reason?: string } })
      .find((e) => e.type === "source_upload_failed");
    expect(failure?.payload?.reason).toContain("409");
    // No revalidation on a failed process.
    expect(catalog.revalidate).not.toHaveBeenCalled();
  });

  it("rolls back and reports failure when the direct storage PUT rejects", async () => {
    const catalog = happyCatalog();
    catalog.putToStorage = vi.fn(async () => {
      throw new Error("403 signature mismatch");
    });
    const { report, events } = recordingReport();
    const removeOptimistic = vi.fn();

    const driver = createSourceUploadDriver({
      catalog,
      report,
      addOptimistic: vi.fn(),
      removeOptimistic,
      log: noopLog,
      newTempId: () => "tmp.abc",
    });

    await expect(
      driver.createSourceFromUpload({ file, name: "x", projectId: "p1" }),
    ).rejects.toThrow();

    expect(removeOptimistic).toHaveBeenCalledWith("tmp.abc");
    expect(events).toContain("source_upload_failed");
    // processUpload is never reached.
    expect(catalog.processUpload).not.toHaveBeenCalled();
  });
});
