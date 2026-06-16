/**
 * dbtMappers — the PURE dbt-manifest boundary mapper, shared by the browser
 * {@link metadataApiSource} and the server-side `/project/:projectId` `loader`.
 * Both map the project's `GET /api/projects/{pid}/export/dbt/manifest` payload
 * identically off this one definition (no drift).
 *
 * No React, no HTTP, no auth imports — just the backend manifest resource (post
 * envelope-unwrap) → the catalog's {@link DbtFile} list. Mirrors
 * {@link import("./lineageMappers")}: the fetch lives in the adapter; this is pure.
 */
import type { Layer } from "../lineage";
import type { DbtFile } from "../models";

/**
 * The dbt manifest resource as the backend returns it (post envelope-unwrap): the
 * file index plus the extra `project_name`/`layer_counts` the current
 * {@link DbtFile} consumer ignores. Mapped to `DbtFile[]` by {@link toDbtFiles}.
 */
export interface BackendDbtManifest {
  id: string;
  project_name?: string;
  layer_counts?: Record<string, number>;
  files: { path: string; layer: Layer | "config"; ref?: string }[];
}

/** Map the backend manifest payload to the catalog's `DbtFile[]` (files only, 1:1). */
export function toDbtFiles(manifest: BackendDbtManifest): DbtFile[] {
  return (manifest.files ?? []).map((f) => ({
    path: f.path,
    layer: f.layer,
    ref: f.ref,
  }));
}
