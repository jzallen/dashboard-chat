// Domain types for the source-upload coordinator statechart: the machine's
// context / event / state shapes, plus the typed-arg alias the actions
// (./actions.ts) annotate their param with. Named-action definitions must spell
// their arg type out (only inline definitions get it inferred), so they share
// `ActionArgs` from here.
//
// CLIENT-REPORTED MODEL (ADR-049/050): the browser is the saga coordinator. This
// machine has NO invokes and performs NO I/O — every transition is driven by a
// past-tense outcome event the browser reports. Imports are type-only; nothing
// here imports machine.ts, so there is no machine ↔ types cycle.
//
// References:
//   docs/decisions/adr-049-*.md  — client-reported outcome-event model
//   docs/decisions/adr-050-*.md  — client-driven application contracts

/** The phases an optimistic source node advances through, as the browser
 *  narrates the Source-creation saga (create → upload → process → link). */
export type SourceUploadState =
  | "idle"
  | "creating_source"
  | "uploading"
  | "processing"
  | "linked"
  | "error_recoverable";

/**
 * The flow context — the identifiers the optimistic canvas node needs to render
 * the current phase and, once linked, reconcile against the real source/dataset
 * after revalidation. Every field is client-reported; none is re-probed here.
 *
 * V1 carries a SINGLE active flow. Multi-concurrent sources (a map keyed by
 * temp_node_id, or one child actor per in-flight source) is a deliberate
 * follow-up — see the note atop machine.ts.
 */
export interface SourceUploadContext {
  /** The optimistic node's client-minted temp id, set when the flow opens and
   *  preserved across the advance so the canvas can swap it for the real id. */
  temp_node_id: string | null;
  /** The real Source id once the browser reports it created. */
  source_id: string | null;
  /** The Upload record id once the browser reports the upload started. */
  upload_id: string | null;
  /** The linked Dataset id once the browser reports the upload processed. */
  dataset_id: string | null;
  /** The project the source belongs to (set when the flow opens). */
  project_id: string | null;
  /** The failure reason carried into error_recoverable (e.g. a schema mismatch
   *  or a failed ingest the browser observed at the backend). */
  error: string | null;
}

/** The past-tense outcome reports the browser narrates as the saga progresses,
 *  PLUS the reset that returns the flow to idle. The transport spreads the wire
 *  payload to the event top level (the parent forwards it verbatim), so each
 *  arrives at this machine with its payload fields at the top level. */
export type SourceUploadEvent =
  | { type: "source_create_requested"; temp_node_id: string; project_id: string }
  | { type: "source_created"; source_id: string }
  | { type: "source_upload_started"; upload_id: string }
  | { type: "source_upload_processed"; dataset_id: string }
  | { type: "source_upload_failed"; reason: string }
  | { type: "source_flow_reset" };

/**
 * Shared typed-arg shape for the extracted actions. `setup()` infers this
 * `{ context, event }` for inline definitions; the extracted assigners annotate
 * their single param with it. `event` is the declared event union.
 */
export interface ActionArgs {
  context: SourceUploadContext;
  event: SourceUploadEvent;
}
