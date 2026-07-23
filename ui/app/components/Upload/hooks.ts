/* Upload-flow state: the upload modal, the archive-confirm dialog it can open,
   and the catalog mutations behind creating / renaming / archiving a source. */
import { useCallback, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import type { LineageNode, SourceUpload } from "../../catalog";
import { createLogger } from "../../lib/log";
import { useStateProxy } from "../../lib/StateProxyProvider";
import type { SourceUploadsData } from "../../routes/ui-server/upload-request";
import { useCatalogFromContext } from "../useCatalog";

const log = createLogger("upload");

/** The payload the upload modal emits when a brand-new dataset is created. */
export type NewSource = {
  file: File | null;
  name: string;
};

/** Schema-mismatch detail surfaced for the recovery UX: the columns the
 *  uploaded file is missing / has extra / has the wrong type for, parsed from a
 *  422 SchemaMismatch error body. */
export type SchemaMismatchDetail = {
  missing: string[];
  extra: string[];
  type_mismatch: { column: string; expected: string; actual: string }[];
};

/** Parse a thrown upload error into a {@link SchemaMismatchDetail}, or `null`
 *  when it is not a 422 schema-mismatch (a network/auth/other failure). The
 *  gateway client throws an `ApiError` whose `body` is the JSON:API error
 *  envelope `{ errors: [{ detail: {missing, extra, type_mismatch} }] }`. */
export function parseSchemaMismatch(
  error: unknown,
): SchemaMismatchDetail | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (status !== 422) return null;
  const body = (error as { body?: unknown }).body;
  const errors = (body as { errors?: unknown })?.errors;
  const detail =
    Array.isArray(errors) && errors[0] && typeof errors[0] === "object"
      ? (errors[0] as { detail?: unknown }).detail
      : undefined;
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Partial<SchemaMismatchDetail>;
  return {
    missing: Array.isArray(d.missing) ? d.missing : [],
    extra: Array.isArray(d.extra) ? d.extra : [],
    type_mismatch: Array.isArray(d.type_mismatch) ? d.type_mismatch : [],
  };
}

/** @param flash - mark a freshly created node so the canvas can pop it. */
export function useUpload(flash: (id: string) => void) {
  const catalog = useCatalogFromContext();
  // The StateProxy.postEvent is the saga's report sink — the browser narrates
  // each past-tense Source-creation outcome to ui-state (zero-egress model).
  const { proxy } = useStateProxy();
  const archiveFetcher = useFetcher();
  // The read leg for the modal's Files list: when the modal opens for an existing
  // source, `.load()` the same-origin source-uploads loader so the browser never
  // hits the backend /api directly. `historyFetcher.data` seeds the modal.
  const historyFetcher = useFetcher<SourceUploadsData>();
  const { revalidate } = useRevalidator();
  const [modal, setModal] = useState<{
    open: boolean;
    source: LineageNode | null;
  }>({ open: false, source: null });
  const [confirmArchive, setConfirmArchive] = useState<LineageNode | null>(
    null,
  );
  // Schema-mismatch recovery (slice 5): when an add-to-existing-source upload is
  // rejected with a 422, the offending columns land here so the modal can show
  // the recovery affordance (retry / pick a different file) instead of just a
  // generic "Failed" badge.
  const [mismatch, setMismatch] = useState<SchemaMismatchDetail | null>(null);

  const openUpload = useCallback(
    (source: LineageNode | null) => {
      setMismatch(null);
      setModal({ open: true, source });
      // Load the persisted upload history only for an existing source (a brand-new
      // upload has none). The loader runs server-side; the browser only hits the
      // same-origin `.data` endpoint, so the no-direct-backend boundary holds.
      if (source) {
        historyFetcher.load(
          `/ui-server/sources/${encodeURIComponent(source.id)}/uploads`,
        );
      }
    },
    [historyFetcher],
  );
  const closeUpload = useCallback(() => {
    setMismatch(null);
    setModal({ open: false, source: null });
  }, []);
  const clearMismatch = useCallback(() => setMismatch(null), []);
  const requestArchive = useCallback(
    (src: LineageNode) => setConfirmArchive(src),
    [],
  );
  const cancelArchive = useCallback(() => setConfirmArchive(null), []);
  const archiveSource = useCallback(
    (src: LineageNode) => {
      // Archive is routed by entity. A SOURCE node backs no backend entity, so
      // archiving one is a CLIENT-ONLY lineage update: move it into the working
      // graph's cold storage and let its connected staging datasets render
      // disabled-but-visible. Nothing is POSTed — no source id threaded to the
      // dataset route (that 404s) and no cascading dataset archive/delete. A
      // genuine DATASET node is a backend entity and still archives through the
      // dataset route, which persists `archived_at`.
      if (src.layer === "source") {
        catalog.archiveSource(src.id);
      } else {
        archiveFetcher.submit(null, {
          method: "POST",
          action: `/ui-server/datasets/${encodeURIComponent(src.id)}/archive`,
          encType: "application/json",
        });
      }
      setConfirmArchive(null);
      closeUpload();
    },
    [archiveFetcher, catalog, closeUpload],
  );
  const renameSource = useCallback(
    (id: string, name: string) => catalog.renameSource(id, name),
    [catalog],
  );
  const existingSource = modal.source;
  const createSource = useCallback(
    async (src: NewSource) => {
      if (!src.file) return;
      setMismatch(null);
      // Path selection by modal.source (slice 5):
      //  - null   → NEW source: createSourceFromUpload adds an optimistic node,
      //             drives create→upload→process, narrates each outcome, then
      //             revalidates. On failure it rolls the optimistic node back.
      //  - source → ADD to that existing source: addUploadToSource skips
      //             createSource and adds NO optimistic node (the source already
      //             exists), driving upload→process against the existing id.
      // Both narrate past-tense outcomes to ui-state via proxy.postEvent and
      // flash the linked/appended dataset so the canvas pops it. On failure we
      // swallow the throw (the canvas error_recoverable phase shows it), but a
      // 422 schema-mismatch is parsed into `mismatch` for the recovery UX.
      try {
        const result = existingSource
          ? await catalog.addUploadToSource(
              existingSource.id,
              src.file,
              proxy.postEvent,
              revalidate,
            )
          : await catalog.createSourceFromUpload(
              src.file,
              src.name,
              proxy.postEvent,
              revalidate,
            );
        if (result?.datasetId) flash(result.datasetId);
      } catch (error) {
        log.warn("createSource.failed", { error: String(error) });
        const detail = parseSchemaMismatch(error);
        if (detail) setMismatch(detail);
      }
    },
    [catalog, flash, proxy, existingSource, revalidate],
  );

  // The persisted history for the open source, once its loader has resolved
  // (undefined while in-flight, or for a brand-new upload). The modal seeds its
  // Files list from this and appends fresh optimistic rows after.
  const uploadFiles: SourceUpload[] | undefined = historyFetcher.data?.uploads;

  return {
    modal,
    uploadFiles,
    openUpload,
    closeUpload,
    confirmArchive,
    requestArchive,
    cancelArchive,
    archiveSource,
    createSource,
    renameSource,
    mismatch,
    clearMismatch,
  };
}
export type UploadApi = ReturnType<typeof useUpload>;
