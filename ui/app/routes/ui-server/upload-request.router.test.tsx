// @vitest-environment happy-dom
//
// Walking skeleton: opening an existing source's upload modal loads its persisted
// history through the REAL source-uploads route loader and renders it in
// the modal's Files list. The loader is driven THROUGH the router (a
// `useFetcher().load()` against `createMemoryRouter`, never called directly), with
// the REAL toSourceUploads mapper and a REAL UploadModal render — the only faked
// seam is the network boundary (global `fetch` returns a JSON:API `uploads`
// envelope). This proves the whole read path end-to-end, not each unit in
// isolation.
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createMemoryRouter, RouterProvider, useFetcher } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineageNode } from "../../catalog";
import { UploadModal } from "../../components/Upload";
import {
  loader as uploadsLoader,
  type SourceUploadsData,
} from "./upload-request";

const existingSource: LineageNode = {
  id: "s1",
  label: "Sales Orders",
  sub: "source",
  layer: "source",
  schema: [{ name: "order_id", type: "number" }],
  files: [],
};

/** Open the modal for the existing source, loading its history via the router. */
function Harness() {
  const fetcher = useFetcher<SourceUploadsData>();
  // Fire the one-shot load on mount only — `fetcher` identity changes across its
  // idle→loading→idle transitions, so depending on it would re-fire in a loop.
  useEffect(() => {
    fetcher.load(`/ui-server/sources/${existingSource.id}/uploads`);
  }, []);
  return (
    <UploadModal
      source={existingSource}
      files={fetcher.data?.uploads}
      onClose={vi.fn()}
      onCreateSource={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
    />
  );
}

/** A JSON:API `uploads` list envelope the faked network boundary returns. */
function uploadsEnvelope(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          type: "uploads",
          id: "u1",
          attributes: {
            original_filename: "q1.csv",
            status: "ingested",
            row_count: 1200,
            created_at: "2026-01-05T09:00:00.000Z",
          },
        },
        {
          type: "uploads",
          id: "u2",
          attributes: {
            original_filename: "q2.csv",
            status: "ingested",
            row_count: 900,
            created_at: "2026-02-14T12:30:00.000Z",
          },
        },
        {
          type: "uploads",
          id: "u3",
          attributes: {
            original_filename: "q3.csv",
            status: "pending",
            row_count: null,
            created_at: "2026-03-20T08:00:00.000Z",
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = "http://auth-proxy.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => uploadsEnvelope()),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("walking skeleton — opening an existing source shows its persisted files", () => {
  it("renders all three persisted files oldest-first, ingested rows with counts and the still-processing file with none", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <Harness /> },
        { path: "/ui-server/sources/:sourceId/uploads", loader: uploadsLoader },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    // The three files land in the Files list, oldest-first (backend order).
    await waitFor(() => {
      const names = screen.getAllByText(/\.csv$/).map((el) => el.textContent);
      expect(names).toEqual(["q1.csv", "q2.csv", "q3.csv"]);
    });

    // Each ingested file shows its row count and short upload date; the
    // still-processing file shows no count.
    expect(screen.getByText("1,200 rows")).toBeTruthy();
    expect(screen.getByText("900 rows")).toBeTruthy();
    expect(screen.getByText("Jan 5")).toBeTruthy();
    expect(screen.getByText("processing…")).toBeTruthy();
    expect(screen.queryByText("0 rows")).toBe(null);
  });
});
