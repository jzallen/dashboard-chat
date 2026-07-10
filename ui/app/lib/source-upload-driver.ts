// source-upload-driver — the client-side saga coordinator for "Create a Source
// from an upload" (slice 4; ADR-049/050 client-reported model). A PURE module:
// a catalog port subset, an optimistic-node port, a report sink
// (StateProxy.postEvent), an id generator, and a logger are injected — so the
// whole ordered create→upload→process saga + the optimistic-node rollback are
// exercised with NO browser, NO React, NO network.
//
// WHY A DRIVER (mirrors lib/onboarding-driver.ts): ui-state is zero-egress — the
// browser drives the backend calls and NARRATES each past-tense outcome to
// ui-state's source-upload child, which transitions on the report. The lineage
// canvas reads the resulting `sourceUpload` region to render the optimistic node
// advancing. The ui/ hook (components/Upload/hooks.ts) composes this driver with
// the real catalog + state-proxy; in-flight UI is the surface's concern.
//
// THE SAGA (no polling — processUpload awaits the linked Dataset):
//   add optimistic source node (temp id)
//   → report source_create_requested {temp_node_id, project_id}
//   → catalog.createSource(name)            → report source_created {source_id}
//   → catalog.requestUpload(sourceId, file) (mints the presigned PUT URL)
//   → catalog.putToStorage(putUrl, file)    (direct browser → MinIO)
//   → report source_upload_started {upload_id}
//   → catalog.processUpload(sourceId, uploadId) → report source_upload_processed
//   → catalog.revalidate()                  (framework re-runs the loader; the real source + staging + edge appear)
// On ANY failure: remove the optimistic node + report source_upload_failed
// {reason}, then re-throw so the surface can surface it.

import type {
  ChatAppStateDocument,
  ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";

import type { LineageNode } from "../catalog";
import type { Logger } from "./log";

// ───────────────────────────── injected ports ─────────────────────────────

/** The catalog port subset the saga drives — the four source-from-upload write
 *  ports plus a scope revalidation. Mirrors the {@link CatalogSource} method
 *  shapes (resolved, not optional, here — the surface only constructs the driver
 *  when a backend source backs them). */
export interface SourceUploadCatalog {
  createSource(name: string): Promise<{ id: string }>;
  requestUpload(
    sourceId: string,
    file: File,
  ): Promise<{ uploadId: string; putUrl: string; storageKey: string }>;
  putToStorage(putUrl: string, file: File): Promise<void>;
  processUpload(
    sourceId: string,
    uploadId: string,
    choices?: Record<string, unknown>,
  ): Promise<{ datasetId: string }>;
  /** Trigger a framework revalidation so the loader re-derives from server truth
   *  and the real source/staging/edge land. */
  revalidate(): Promise<void>;
}

/** The report sink — the StateProxy.postEvent signature. */
export type ReportSink = (
  event: ChatAppWireEvent,
) => Promise<ChatAppStateDocument>;

export interface SourceUploadDriverDeps {
  catalog: SourceUploadCatalog;
  report: ReportSink;
  /** Add the optimistic source node to the canvas (catalog.addSource). */
  addOptimistic: (node: LineageNode) => void;
  /** Roll back the optimistic node on failure (catalog.removeSource). */
  removeOptimistic: (id: string) => void;
  log: Logger;
  /** Generate a temp node id; injected so tests are deterministic. */
  newTempId: () => string;
}

/** The command the surface (the upload modal) issues for a NEW source. */
export interface CreateSourceFromUploadCommand {
  file: File;
  name: string;
  projectId: string;
}

/** The command the surface issues to ADD a file to an EXISTING source (slice 5). */
export interface AddUploadToSourceCommand {
  file: File;
  sourceId: string;
  projectId: string;
}

export interface SourceUploadDriver {
  /** Run the full new-source saga; resolves the linked dataset id + the temp
   *  node id used for the optimistic node, or rejects (after rollback + failure
   *  report). */
  createSourceFromUpload(
    command: CreateSourceFromUploadCommand,
  ): Promise<{ datasetId: string; tempNodeId: string }>;
  /** Add a file to an EXISTING source: skips createSource and adds NO optimistic
   *  node (the source already exists). Drives requestUpload→putToStorage→process,
   *  narrating source_upload_started/processed. On failure reports
   *  source_upload_failed and RE-THROWS the original error (so the surface can
   *  read a 422 schema-mismatch body); the existing node is never rolled back. */
  addUploadToSource(
    command: AddUploadToSourceCommand,
  ): Promise<{ datasetId: string }>;
}

// ───────────────────────────── the driver factory ─────────────────────────────

export function createSourceUploadDriver(
  deps: SourceUploadDriverDeps,
): SourceUploadDriver {
  const { catalog, report, addOptimistic, removeOptimistic, log, newTempId } =
    deps;

  // Narration is a side-channel: the saga reports each past-tense outcome to
  // ui-state so the canvas can advance the optimistic node, but a broken report
  // path (StateProxy.postEvent rejecting) must NEVER abort the real create→
  // upload→process work or trip the failure rollback. A failed narration is
  // logged and swallowed; revalidate() still heals the node into the real
  // source. Only genuine catalog failures roll the optimistic node back.
  const safeReport = async (event: ChatAppWireEvent): Promise<void> => {
    try {
      await report(event);
    } catch (error) {
      log.warn("source-upload.report.dropped", {
        event: event.type,
        reason: reasonOf(error),
      });
    }
  };

  const optimisticNode = (id: string, label: string): LineageNode => ({
    id,
    label,
    sub: "source",
    layer: "source",
    schema: [],
    files: [],
  });

  const createSourceFromUpload = async ({
    file,
    name,
    projectId,
  }: CreateSourceFromUploadCommand): Promise<{
    datasetId: string;
    tempNodeId: string;
  }> => {
    const tempNodeId = newTempId();
    const label = name.trim() || file.name;
    addOptimistic(optimisticNode(tempNodeId, label));

    try {
      await safeReport({
        type: "source_create_requested",
        payload: { temp_node_id: tempNodeId, project_id: projectId },
      });

      const { id: sourceId } = await catalog.createSource(label);
      await safeReport({ type: "source_created", payload: { source_id: sourceId } });

      const datasetId = await runUpload(sourceId, file);

      await catalog.revalidate();
      log.info("source-upload.linked", { sourceId, datasetId });
      return { datasetId, tempNodeId };
    } catch (error) {
      log.warn("source-upload.failed", { tempNodeId, reason: reasonOf(error) });
      removeOptimistic(tempNodeId);
      await safeReport({
        type: "source_upload_failed",
        payload: { reason: reasonOf(error) },
      });
      throw error;
    }
  };

  // The upload leg shared by both flows: requestUpload → direct MinIO PUT →
  // started → process → processed. Resolves the linked/appended dataset id.
  const runUpload = async (sourceId: string, file: File): Promise<string> => {
    const { uploadId, putUrl } = await catalog.requestUpload(sourceId, file);
    await catalog.putToStorage(putUrl, file);
    await safeReport({
      type: "source_upload_started",
      payload: { upload_id: uploadId },
    });

    const { datasetId } = await catalog.processUpload(sourceId, uploadId);
    await safeReport({
      type: "source_upload_processed",
      payload: { dataset_id: datasetId },
    });
    return datasetId;
  };

  const addUploadToSource = async ({
    file,
    sourceId,
  }: AddUploadToSourceCommand): Promise<{ datasetId: string }> => {
    try {
      const datasetId = await runUpload(sourceId, file);
      await catalog.revalidate();
      log.info("source-upload.appended", { sourceId, datasetId });
      return { datasetId };
    } catch (error) {
      // No optimistic node to roll back — the source already exists. Report the
      // failure (the canvas error_recoverable phase) and re-throw the ORIGINAL
      // error so the surface can read a 422 schema-mismatch body for its UX.
      log.warn("source-upload.append.failed", { sourceId, reason: reasonOf(error) });
      await safeReport({
        type: "source_upload_failed",
        payload: { reason: reasonOf(error) },
      });
      throw error;
    }
  };

  return { createSourceFromUpload, addUploadToSource };
}

/** A human-readable failure reason from any thrown value (Error, ApiError, or
 *  a plain object with a `message`). */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
