import { afterEach, describe, expect, it, vi } from "vitest";

import { metadataApiSource } from "./metadataApiSource";

/**
 * metadataApiSource is now WRITES-ONLY: every read is seeded server-side by the
 * app-shell / project-layout loaders, so this source never reads the backend from
 * the browser. Each write goes same-origin to a `/ui-server/*` action (the browser
 * never touches `/api`), except the presigned storage PUT which is direct to
 * object storage. These tests pin the ui-server paths + the failure contract.
 */

/** A fetch stub that returns a JSON body and records each request init. */
function stubFetch(body: unknown, ok = true, status = ok ? 200 : 500) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("metadataApiSource — toggleAuditEntry (optimistic write-through PATCH)", () => {
  it("PATCHes the project-scoped ui-server audit-entry action with the enabled body", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({
      getToken: () => "secret-token",
      getProjectId: () => "p1",
    });

    await source.toggleAuditEntry!("ae1", false);

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/projects/p1/audit/ae1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body as string)).toEqual({ enabled: false });
    expect(call[1].credentials).toBe("include");
    expect(
      (call[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("throws when no project scope is available (a scoped write with no pid)", async () => {
    stubFetch({ data: {} });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.toggleAuditEntry!("ae1", true)).rejects.toThrow();
  });

  it("rejects on a non-2xx PATCH response (drives the catalog rollback)", async () => {
    stubFetch({ detail: "boom" }, false);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    await expect(source.toggleAuditEntry!("ae1", true)).rejects.toThrow();
  });
});

describe("metadataApiSource — renameModel (optimistic write-through PATCH)", () => {
  it("renames a dataset via the org-global ui-server action, setting display_name", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.renameModel!("d1", "dataset", "Customers");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/datasets/d1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body as string)).toEqual({
      display_name: "Customers",
    });
  });

  it("renames a view via the project-scoped ui-server action, setting name", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.renameModel!("v1", "view", "High Value Orders");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/projects/p1/views/v1");
    expect(JSON.parse(call[1].body as string)).toEqual({
      name: "High Value Orders",
    });
  });

  it("renames a report via the project-scoped ui-server action, setting name", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.renameModel!("r1", "report", "Revenue");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/projects/p1/reports/r1");
    expect(JSON.parse(call[1].body as string)).toEqual({ name: "Revenue" });
  });

  it("rejects on a non-2xx PATCH response (drives the catalog rollback)", async () => {
    stubFetch({ detail: "boom" }, false);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    await expect(source.renameModel!("v1", "view", "x")).rejects.toThrow();
  });
});

describe("metadataApiSource — setModelName (machine-name PATCH)", () => {
  it("PATCHes the dataset ui-server action with model_name (separate from display_name)", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.setModelName!("d1", "stg_warm_leads");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/datasets/d1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body as string)).toEqual({
      model_name: "stg_warm_leads",
    });
    expect(JSON.parse(call[1].body as string)).not.toHaveProperty(
      "display_name",
    );
  });

  it("rejects on a non-2xx (e.g. 409 collision) so the caller surfaces it", async () => {
    stubFetch({ detail: "collision" }, false, 409);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    await expect(
      source.setModelName!("d1", "stg_warm_leads"),
    ).rejects.toThrow();
  });
});

describe("metadataApiSource — archiveModel / restoreModel (soft-delete POST)", () => {
  it("archives a dataset via POST /ui-server/datasets/{id}/archive", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.archiveModel!("d1", "dataset");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/datasets/d1/archive");
    expect(call[1].method).toBe("POST");
    expect(call[1].credentials).toBe("include");
  });

  it("restores a dataset via POST /ui-server/datasets/{id}/restore", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.restoreModel!("d1", "dataset");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/datasets/d1/restore");
    expect(call[1].method).toBe("POST");
    expect(call[1].credentials).toBe("include");
  });

  it("no-ops (no request) for a non-dataset kind — views/reports have no soft-delete", async () => {
    const fetchMock = stubFetch({ data: {} });
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.archiveModel!("v1", "view");
    await source.restoreModel!("r1", "report");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects on a non-2xx archive response (drives the catalog rollback)", async () => {
    stubFetch({ detail: "boom" }, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.archiveModel!("d1", "dataset")).rejects.toThrow();
  });
});

describe("metadataApiSource — createDataset (one-step multipart upload)", () => {
  it("POSTs the multipart FormData to /ui-server/uploads and returns the dataset id", async () => {
    const fetchMock = stubFetch({ data: { id: "ds.x" } }, true, 201);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    const file = new File(["a,b\n1,2\n"], "x.csv", { type: "text/csv" });
    const res = await source.createDataset!(file);

    expect(res).toEqual({ id: "ds.x" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Same-origin to the ui-server action — NOT a browser-direct /api/uploads
    // call. The action forwards the multipart body to the backend server-side.
    expect(call[0]).toBe("/ui-server/uploads");
    expect(call[1].method).toBe("POST");
    const fd = call[1].body as FormData;
    expect(fd.get("project_id")).toBe("p1");
    expect(fd.get("file")).toBeTruthy();
  });

  it("rejects on a non-2xx upload response", async () => {
    stubFetch({}, false);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    await expect(source.createDataset!(file)).rejects.toThrow();
  });
});

describe("metadataApiSource — createSource (POST /ui-server/sources)", () => {
  it("POSTs project_id + name and returns the created source id (JSON:API unwrap)", async () => {
    const fetchMock = stubFetch(
      { data: { type: "sources", id: "src.new", attributes: { name: "orders_csv" } } },
      true,
      201,
    );
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    const res = await source.createSource!("orders_csv");

    expect(res).toEqual({ id: "src.new" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/sources");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({
      project_id: "p1",
      name: "orders_csv",
    });
    expect(call[1].credentials).toBe("include");
  });

  it("rejects on a non-2xx create response", async () => {
    stubFetch({}, false);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    await expect(source.createSource!("x")).rejects.toThrow();
  });
});

describe("metadataApiSource — requestUpload (POST /ui-server/sources/:id/uploads, RAW 202)", () => {
  it("POSTs the file descriptor and returns the raw presign body (NOT envelope-unwrapped)", async () => {
    const fetchMock = stubFetch(
      {
        upload_id: "up.1",
        put_url: "https://minio.local/bucket/key?sig=abc",
        storage_key: "uploads/p1/s1/up.1/orders.csv",
        status: "pending",
      },
      true,
      202,
    );
    const source = metadataApiSource({ getToken: () => "tok" });

    const file = new File(["a,b\n1,2\n"], "orders.csv", { type: "text/csv" });
    const res = await source.requestUpload!("s1", file);

    expect(res).toEqual({
      uploadId: "up.1",
      putUrl: "https://minio.local/bucket/key?sig=abc",
      storageKey: "uploads/p1/s1/up.1/orders.csv",
    });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/sources/s1/uploads");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({
      filename: "orders.csv",
      content_type: "text/csv",
      size: file.size,
    });
    expect(call[1].credentials).toBe("include");
  });

  it("rejects on a non-2xx upload-record response", async () => {
    stubFetch({}, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    await expect(source.requestUpload!("s1", file)).rejects.toThrow();
  });
});

describe("metadataApiSource — putToStorage (DIRECT browser→MinIO PUT)", () => {
  it("PUTs the file bytes to the presigned URL with the file's Content-Type and NO auth", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const source = metadataApiSource({ getToken: () => "secret-token" });

    const file = new File(["a,b\n1,2\n"], "orders.csv", { type: "text/csv" });
    await source.putToStorage!("https://minio.local/bucket/key?sig=abc", file);

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Direct to the presigned URL, bypassing the app/auth-proxy — the one allowed
    // non-gateway browser request.
    expect(call[0]).toBe("https://minio.local/bucket/key?sig=abc");
    expect(call[1].method).toBe("PUT");
    expect(call[1].body).toBe(file);
    expect((call[1].headers as Record<string, string>)["Content-Type"]).toBe(
      "text/csv",
    );
    expect(call[1].credentials).not.toBe("include");
    expect(
      (call[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("rejects when MinIO returns a non-2xx (e.g. a signature mismatch)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const source = metadataApiSource({ getToken: () => "tok" });
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    await expect(
      source.putToStorage!("https://minio.local/bucket/key", file),
    ).rejects.toThrow();
  });
});

describe("metadataApiSource — processUpload (POST /ui-server/sources/:id/uploads/:id/process)", () => {
  it("POSTs the process step and unwraps the linked dataset id", async () => {
    const fetchMock = stubFetch({
      data: { type: "datasets", id: "ds.linked", attributes: { source_id: "s1" } },
    });
    const source = metadataApiSource({ getToken: () => "tok" });

    const res = await source.processUpload!("s1", "up.1");

    expect(res).toEqual({ datasetId: "ds.linked" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/ui-server/sources/s1/uploads/up.1/process");
    expect(call[1].method).toBe("POST");
    expect(call[1].credentials).toBe("include");
  });

  it("forwards choices when provided (sheet-selection path)", async () => {
    const fetchMock = stubFetch({
      data: { type: "datasets", id: "ds.x", attributes: {} },
    });
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.processUpload!("s1", "up.1", { sheet: "Sheet1" });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toEqual({
      choices: { sheet: "Sheet1" },
    });
  });

  it("rejects on a 4xx (e.g. 409 schema-mismatch / append-not-supported)", async () => {
    stubFetch({ detail: "schema mismatch" }, false, 409);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.processUpload!("s1", "up.1")).rejects.toThrow();
  });
});
