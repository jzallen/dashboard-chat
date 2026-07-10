// @vitest-environment node
//
// toSourceUploads — the pure JSON:API `uploads` → SourceUpload[] mapper the
// source-uploads loader (and any future browser source) map identically off. No
// fetch, no React: backend snake_case upload resource → the catalog DTO the
// upload modal's Files list renders. The list order is the mapper's contract
// (oldest-first, as the backend returns it); the `when` date is derived from
// `created_at` with a pinned locale + time zone, so it doesn't drift under test.
import { describe, expect, it } from "vitest";

import { type BackendUpload, toSourceUploads } from "./uploadMappers";

/** An ingested upload resource as the backend returns it (post envelope-unwrap). */
function ingested(
  name: string,
  rows: number,
  createdAt: string,
): BackendUpload {
  return {
    id: `u-${name}`,
    original_filename: name,
    file_size: 1024,
    status: "ingested",
    row_count: rows,
    created_at: createdAt,
  };
}

describe("toSourceUploads — backend uploads → the modal's Files list DTO", () => {
  it("maps each field (name←original_filename, rows←row_count, when←created_at, status passthrough) and preserves the backend's oldest-first order", () => {
    const uploads: BackendUpload[] = [
      ingested("jan.csv", 100, "2026-01-05T09:00:00.000Z"),
      ingested("feb.csv", 250, "2026-02-14T12:30:00.000Z"),
    ];

    expect(toSourceUploads(uploads)).toEqual([
      { name: "jan.csv", rows: 100, when: "Jan 5", status: "ingested" },
      { name: "feb.csv", rows: 250, when: "Feb 14", status: "ingested" },
    ]);
  });

  it("carries a still-pending upload through with a null row count (no count yet)", () => {
    const pending: BackendUpload = {
      id: "u-pending",
      original_filename: "loading.csv",
      file_size: 2048,
      status: "pending",
      row_count: null,
      created_at: "2026-03-01T00:00:00.000Z",
    };

    expect(toSourceUploads([pending])).toEqual([
      { name: "loading.csv", rows: null, when: "Mar 1", status: "pending" },
    ]);
  });

  it("maps an empty list to an empty list (an empty history is not a failure)", () => {
    expect(toSourceUploads([])).toEqual([]);
  });
});
