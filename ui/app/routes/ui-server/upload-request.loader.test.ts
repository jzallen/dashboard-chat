// @vitest-environment node
//
// The /ui-server/sources/:sourceId/uploads GET loader — the read leg of the
// source-uploads resource route (co-located with the POST write action). It
// fetches the source's upload history through the server /api client, unwraps the
// JSON:API envelope, and maps it with toSourceUploads for the upload modal's Files
// list.
//
// Unlike the project-layout loader, a non-401 read failure DEGRADES GRACEFULLY to
// an empty list (the modal must still open and accept a fresh upload) rather than
// throwing to an ErrorBoundary; a 401 still redirects to /login. Node env (not
// happy-dom) so the forwarded `cookie` survives on the outbound Request, matching
// the server runtime; the network is stubbed at the global `fetch` boundary.
import type { LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./upload-request";

const AUTH_PROXY_URL = "http://auth-proxy.test";

type Captured = { url: string; init: RequestInit };

/** Build the loader args for the source-uploads route scoped to `sourceId`. */
function loaderArgs(request: Request, sourceId: string): LoaderFunctionArgs {
  return { request, params: { sourceId } } as unknown as LoaderFunctionArgs;
}

/** Stub global fetch with a per-URL handler; returns the captured calls. */
function stubFetch(handler: (url: string) => Response): () => Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push({ url, init: init ?? {} });
      return handler(url);
    },
  );
  return () => calls;
}

/** A JSON:API list envelope of `uploads`: `{ data: [{ type, id, attributes }] }`. */
function uploadsEnvelope(
  resources: { id: string; attributes: Record<string, unknown> }[],
): Response {
  const data = resources.map((r) => ({
    type: "uploads",
    id: r.id,
    attributes: r.attributes,
  }));
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** An authenticated inbound request carrying the user's session credential. */
function authedRequest(): Request {
  return new Request("http://localhost/ui-server/sources/s1/uploads", {
    headers: new Headers({
      cookie: "auth_token=abc",
      authorization: "Bearer user-jwt",
    }),
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("source-uploads loader — a source's persisted upload history via the server /api hop", () => {
  // AC1 — the read reaches the backend server-side (through /api, forwarding the
  // inbound credential), unwraps + maps to the Files-list DTOs oldest-first.
  it("fetches GET /sources/:id/uploads scoped to the sourceId, forwards the inbound credential, and returns the mapped uploads oldest-first", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/api/sources/s1/uploads")) {
        return uploadsEnvelope([
          {
            id: "u1",
            attributes: {
              original_filename: "jan.csv",
              file_size: 10,
              status: "ingested",
              row_count: 100,
              created_at: "2026-01-05T09:00:00.000Z",
            },
          },
          {
            id: "u2",
            attributes: {
              original_filename: "feb.csv",
              file_size: 20,
              status: "pending",
              row_count: null,
              created_at: "2026-02-14T12:30:00.000Z",
            },
          },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await loader(loaderArgs(authedRequest(), "s1"));

    expect(calls().map((c) => c.url)).toEqual([
      `${AUTH_PROXY_URL}/api/sources/s1/uploads`,
    ]);
    expect(new Headers(calls()[0].init.headers).get("cookie")).toBe(
      "auth_token=abc",
    );
    expect(result).toEqual({
      uploads: [
        { name: "jan.csv", rows: 100, when: "Jan 5", status: "ingested" },
        { name: "feb.csv", rows: null, when: "Feb 14", status: "pending" },
      ],
    });
  });

  // AC2 — an empty-but-OK history is not a failure: it resolves to an empty list
  // (the modal keeps its "No files yet" branch).
  it("resolves an empty list when the source has no recorded uploads", async () => {
    stubFetch(() => uploadsEnvelope([]));

    const result = await loader(loaderArgs(authedRequest(), "s1"));

    expect(result).toEqual({ uploads: [] });
  });

  // AC3 — a non-401 upstream failure degrades gracefully (empty list, NO throw),
  // the OPPOSITE of the project loader: the modal must still open and accept a
  // fresh upload rather than rendering an ErrorBoundary.
  it("degrades a non-401 read failure to an empty list instead of throwing", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));

    const result = await loader(loaderArgs(authedRequest(), "s1"));

    expect(result).toEqual({ uploads: [] });
  });

  // AC3 — a 401 is the unauthenticated signal, turned into a /login redirect
  // (mirroring the app-shell/project loaders), not a graceful empty.
  it("redirects to /login when the read returns 401", async () => {
    stubFetch(() => new Response("Unauthorized", { status: 401 }));

    expect.assertions(1);
    try {
      await loader(loaderArgs(authedRequest(), "s1"));
    } catch (thrown) {
      expect(
        thrown instanceof Response
          ? { status: thrown.status, location: thrown.headers.get("Location") }
          : thrown,
      ).toEqual({ status: 302, location: "/login" });
    }
  });
});
