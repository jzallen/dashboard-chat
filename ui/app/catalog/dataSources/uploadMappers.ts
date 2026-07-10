/**
 * uploadMappers — the PURE mapper adapting a source's backend uploads
 * (`GET /api/sources/{id}/uploads`) to the {@link SourceUpload} the upload
 * modal's Files list renders. Mirrors {@link sessionMappers}/{@link metadataMappers}:
 * the fetch lives in the source-uploads loader (which unwraps the JSON:API
 * envelope via {@link unwrapList}); this module is pure so the loader and any
 * future browser source map identically off one definition (no drift).
 *
 * No React, no HTTP, no `Date.now()` — the `when` date is derived from each
 * upload's `created_at` deterministically (UTC parts, no locale), so the mapping
 * is stable under test.
 */
import type { SourceUpload } from "./source";

/**
 * An upload resource as the backend returns it (post envelope-unwrap): snake_case
 * attributes flat alongside the resource `id`. `row_count` is `null` while the
 * upload is still processing (`status: "pending"`); `status` is `"ingested"` once
 * the rows have landed.
 */
export interface BackendUpload {
  id: string;
  original_filename: string;
  file_size?: number;
  status: string;
  row_count: number | null;
  created_at: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * A short, locale-free upload date ("Jun 15") derived from an ISO-UTC timestamp.
 * Formatted from the UTC month/day so it neither depends on the runner's timezone
 * nor drifts under test, matching the modal's compact `when` column.
 */
function formatUploadDate(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Map a source's backend uploads to the {@link SourceUpload} Files-list DTOs:
 * `name` ← `original_filename`, `rows` ← `row_count` (kept `null` for a pending
 * upload, so the row renders no count), `when` ← a short date from `created_at`,
 * `status` passes through. Order is preserved (the backend returns oldest-first),
 * so the caller renders the history in the same sequence.
 */
export function toSourceUploads(uploads: BackendUpload[]): SourceUpload[] {
  return uploads.map((upload) => ({
    name: upload.original_filename,
    rows: upload.row_count,
    when: formatUploadDate(upload.created_at),
    status: upload.status,
  }));
}
