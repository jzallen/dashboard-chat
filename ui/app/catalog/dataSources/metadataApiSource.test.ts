import { afterEach, describe, expect, it, vi } from "vitest";

import { metadataApiSource } from "./metadataApiSource";

/**
 * metadataApiSource is now WRITES-ONLY: every read is seeded server-side by the
 * app-shell / project-layout loaders, so this source never reads the backend from
 * the browser. Model-level mutations (rename / model_name / audit / archive /
 * restore) land through the RRv7 route actions, not this source. What remains here
 * is the source-from-upload saga: each write goes same-origin to a `/ui-server/*`
 * action (the browser never touches `/api`), except the presigned storage PUT
 * which is direct to object storage. These tests pin the ui-server paths + the
 * failure contract.
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
