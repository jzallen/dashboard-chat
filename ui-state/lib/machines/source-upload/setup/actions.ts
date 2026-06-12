// Actions for the source-upload statechart — the ONLY writers of machine
// context. Each is a bare `assign` closure, param-annotated with the shared
// `ActionArgs` alias (./types.ts); the `assign(...)` wrap happens at the
// `setup()` call in ../machine.ts, where inference flows from `setup`'s `types`
// — no xstate generics are pinned here.
//
// `event` is the FULL declared event union for EVERY action: `setup` types each
// named action's expression-event as the whole `TEvent`, regardless of which
// transition references it. So each assigner narrows on `event.type` before
// reading the report's payload fields.

import type { ActionArgs } from "./types.ts";

/** idle → creating_source: open the optimistic node, recording its temp id and
 *  the project it belongs to (both client-reported). */
export const assignSourceRequested = ({ event }: ActionArgs) => {
  if (event.type !== "source_create_requested") return {};
  return { temp_node_id: event.temp_node_id, project_id: event.project_id };
};

/** creating_source → uploading: record the real Source id the browser reported. */
export const assignSourceCreated = ({ event }: ActionArgs) => {
  if (event.type !== "source_created") return {};
  return { source_id: event.source_id };
};

/** uploading → processing: record the Upload record id the browser reported. */
export const assignUploadStarted = ({ event }: ActionArgs) => {
  if (event.type !== "source_upload_started") return {};
  return { upload_id: event.upload_id };
};

/** processing → linked: record the linked Dataset id the browser reported. */
export const assignUploadProcessed = ({ event }: ActionArgs) => {
  if (event.type !== "source_upload_processed") return {};
  return { dataset_id: event.dataset_id };
};

/** (uploading|processing) → error_recoverable: record the failure reason the
 *  browser observed (schema mismatch / failed ingest). */
export const assignUploadFailed = ({ event }: ActionArgs) => {
  if (event.type !== "source_upload_failed") return {};
  return { error: event.reason };
};

/** any → idle: clear all in-flight context so the flow can begin again. */
export const clearFlow = () => ({
  temp_node_id: null,
  source_id: null,
  upload_id: null,
  dataset_id: null,
  project_id: null,
  error: null,
});
