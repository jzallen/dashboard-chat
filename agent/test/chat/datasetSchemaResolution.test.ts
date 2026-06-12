import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";
import { mockStreamTextResult } from "./_v6Mocks";

// Same AI-SDK mock as handleChat.test: keep the v6 SSE pipeline real, only
// replace the Groq call and the `tool` wrapper.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(() =>
      mockStreamTextResult([
        { type: "text-start", id: "m1" },
        { type: "text-delta", id: "m1", delta: "ok" },
        { type: "text-end", id: "m1" },
        { type: "finish", finishReason: "stop" },
      ]),
    ),
    tool: vi.fn((opts: unknown) => opts),
  };
});

vi.mock("@ai-sdk/groq", () => ({
  createGroq: () => () => "mock-model",
}));

const env = { GROQ_API_KEY: "test-key", AUTH_PROXY_URL: "http://auth-proxy.test" };

// A dataset-scoped request: scope carries the dataset resource, body omits
// tableSchema (exactly what the cookie-only ui/ POST sends).
function datasetRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Active-Scope": JSON.stringify({
        org_id: "test-org",
        project_id: "test-project",
        resource_type: "dataset",
        resource_id: "ds-1",
      }),
      "X-Org-Id": "test-org",
    },
    body: JSON.stringify(body),
  });
}

function lastStreamTextArgs(streamText: unknown) {
  return (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
}

const datasetResponse = {
  schema_config: { fields: { email: { type: "text" }, age: { type: "number" } } },
  transforms: [],
};

describe("handleChat — agent resolves dataset schema (slice-3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the DATASET prompt + cleaning tools when datasetId is in scope and NO tableSchema is sent", async () => {
    const { streamText } = await import("ai");
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(datasetResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const response = await handleChat(
      datasetRequest({
        messages: [{ role: "user", content: "lowercase email" }],
        contextType: "dataset",
        contextId: "ds-1",
        // tableSchema deliberately omitted
      }),
      env,
    );

    expect(response.status).not.toBe(400);
    // The agent fetched the schema from the backend.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("/api/datasets/ds-1?include_transforms=true");

    const args = lastStreamTextArgs(streamText);
    // DATASET prompt — NOT the conversational "cannot perform table operations" one.
    expect(args.system).toContain("controls a data table");
    expect(args.system).not.toContain("No dataset or view is currently selected");
    // Cleaning tools present in the final toolset.
    expect(args.tools).toHaveProperty("standardizeCase");
    expect(args.tools).toHaveProperty("applyCleaningTransform");
  });

  it("skips the backend GET when the caller already supplied a tableSchema (fast path)", async () => {
    const { streamText } = await import("ai");
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(datasetResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await handleChat(
      datasetRequest({
        messages: [{ role: "user", content: "lowercase email" }],
        contextType: "dataset",
        contextId: "ds-1",
        tableSchema: { columns: [{ id: "email", type: "string" }], rowCount: 3 },
      }),
      env,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    const args = lastStreamTextArgs(streamText);
    expect(args.system).toContain("controls a data table");
  });

  it("degrades to the conversational prompt and logs a warning when the dataset GET fails", async () => {
    const { streamText } = await import("ai");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);

    const response = await handleChat(
      datasetRequest({
        messages: [{ role: "user", content: "lowercase email" }],
        contextType: "dataset",
        contextId: "ds-1",
      }),
      env,
    );

    // Turn did not crash.
    expect(response.status).not.toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const args = lastStreamTextArgs(streamText);
    expect(args.system).toContain("No dataset or view is currently selected");

    // A diagnosable warning was logged (not a silent repeat of the bug).
    const warnedSchemaFailure = warn.mock.calls.some((c) =>
      JSON.stringify(c).includes("ds-1"),
    );
    expect(warnedSchemaFailure).toBe(true);
  });
});
