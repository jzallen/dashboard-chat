// SourceUploadMachine — XState v5 statechart for the source-upload coordinator.
//
// The BROWSER is the saga coordinator (client-reported model — ADR-049/050; no
// invokes, no egress). This machine only RECORDS the reported outcomes of a
// Source-creation flow and exposes the current phase so the lineage canvas can
// render an optimistic source node advancing through:
//
//   create Source → upload file (direct to MinIO) → process (ingest + link
//   Dataset) → linked.
//
// States (every one settles the instant it is reached — there are no invokes):
//   - idle             — cold-start; no flow open. A source_create_requested
//                        opens the optimistic node.
//   - creating_source  — the browser is POSTing /api/sources; advances on the
//                        client's source_created report.
//   - uploading        — the source exists; the browser PUTs the file direct to
//                        MinIO; advances on source_upload_started.
//   - processing       — the browser triggered ingestion; advances on
//                        source_upload_processed.
//   - linked           — the Dataset is linked; the optimistic node reconciles
//                        against the real source/dataset after revalidation.
//   - error_recoverable — REPORT-ACCEPTING retryable landing (NOT a dead end):
//                        a schema mismatch / failed ingest lands here; a
//                        source_flow_reset returns to idle so the browser can
//                        re-enter the flow.
//
// V1 carries ONE active flow. MULTI-CONCURRENT sources (several optimistic nodes
// advancing at once) is a deliberate follow-up: model it as a map keyed by
// temp_node_id, or spawn one child actor per in-flight source under a parent
// region. Not needed for v1 (the UI drives one Create-Source at a time).
//
// This file is MAPPING ONLY: it wires the setup pieces (./setup/) and lays out
// the transitions. Provide a `createSourceUploadMachine()` factory mirroring
// `createOnboardingMachine()`.
//
// References:
//   docs/decisions/adr-049-*.md  — client-reported outcome-event model
//   docs/decisions/adr-050-*.md  — client-driven application contracts
//   ../onboarding/machine.ts     — the client-reported machine shape mirrored here

import { assign, setup } from "xstate";

import {
  assignSourceCreated,
  assignSourceRequested,
  assignUploadFailed,
  assignUploadProcessed,
  assignUploadStarted,
  clearFlow,
} from "./setup/actions.ts";
import type { SourceUploadContext, SourceUploadEvent } from "./setup/types.ts";

export function createSourceUploadMachine() {
  return setup({
    types: {
      context: {} as SourceUploadContext,
      events: {} as SourceUploadEvent,
    },
    actions: {
      assignSourceRequested: assign(assignSourceRequested),
      assignSourceCreated: assign(assignSourceCreated),
      assignUploadStarted: assign(assignUploadStarted),
      assignUploadProcessed: assign(assignUploadProcessed),
      assignUploadFailed: assign(assignUploadFailed),
      clearFlow: assign(clearFlow),
    },
  }).createMachine({
    id: "source-upload",
    initial: "idle",
    context: {
      temp_node_id: null,
      source_id: null,
      upload_id: null,
      dataset_id: null,
      project_id: null,
      error: null,
    },
    // source_flow_reset is accepted in EVERY phase (any → idle), so it is declared
    // once at the top level rather than on each state.
    on: {
      source_flow_reset: { target: ".idle", actions: "clearFlow" },
    },
    states: {
      idle: {
        on: {
          source_create_requested: {
            target: "creating_source",
            actions: "assignSourceRequested",
          },
        },
      },
      creating_source: {
        on: {
          source_created: { target: "uploading", actions: "assignSourceCreated" },
        },
      },
      uploading: {
        on: {
          source_upload_started: {
            target: "processing",
            actions: "assignUploadStarted",
          },
          // A direct-to-MinIO upload that the browser observed failing (e.g. a
          // schema mismatch surfaced before processing) lands recoverable.
          source_upload_failed: {
            target: "error_recoverable",
            actions: "assignUploadFailed",
          },
        },
      },
      processing: {
        on: {
          source_upload_processed: {
            target: "linked",
            actions: "assignUploadProcessed",
          },
          // The UI-triggered process step failed (schema mismatch / failed
          // ingest) — surfaced as a 4xx the browser reports here.
          source_upload_failed: {
            target: "error_recoverable",
            actions: "assignUploadFailed",
          },
        },
      },
      linked: {},
      // Recoverable-error landing — NOT a dead end. A source_flow_reset (handled
      // at the top level) returns to idle so the browser can re-enter the flow.
      error_recoverable: {},
    },
  });
}
