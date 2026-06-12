// Unit tests for the SourceUploadMachine — drives the state machine through
// `createActor` and asserts the observable outcome (the actor's settled state +
// context) the caller sees.
//
// CLIENT-REPORTED MODEL (ADR-049/050): the browser is the saga coordinator. This
// machine has NO invokes and performs NO I/O — it only RECORDS the reported
// outcomes of a Source-creation flow (create → upload → process → link) and
// exposes the current phase so the canvas can render an optimistic source node
// advancing. It mirrors the onboarding machine's report-driven shape.
//
// All tests are port-to-port at the machine driving port (the XState actor's
// public `send` / snapshot surface). No internal-class assertions. Each `it`
// states the outcome the caller observes — phrased as behavior the user
// experiences (a source node advancing), not machine internals.
//
// References:
//   docs/decisions/adr-049-*.md  — client-reported outcome-event model
//   docs/decisions/adr-050-*.md  — client-driven application contracts

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { createSourceUploadMachine } from "./machine.ts";

const TEMP_NODE = "tmp-node-1";
const PROJECT = "proj-A";

/** Start a fresh source-upload actor in its cold-start `idle` state. */
function startFlow() {
  const actor = createActor(createSourceUploadMachine());
  actor.start();
  return actor;
}

/** Drive a flow all the way to `uploading` (source created, file requested). */
function startUploading() {
  const actor = startFlow();
  actor.send({ type: "source_create_requested", temp_node_id: TEMP_NODE, project_id: PROJECT });
  actor.send({ type: "source_created", source_id: "src-1" });
  return actor;
}

describe("when the browser begins a source-creation flow", () => {
  it("settles idle on cold-start, holding no source yet", () => {
    const snap = startFlow().getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.temp_node_id).toBeNull();
    expect(snap.context.source_id).toBeNull();
    expect(snap.context.project_id).toBeNull();
  });

  it("opens an optimistic source node when the browser reports the create was requested", () => {
    const actor = startFlow();
    actor.send({ type: "source_create_requested", temp_node_id: TEMP_NODE, project_id: PROJECT });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("creating_source");
    expect(snap.context.temp_node_id).toBe(TEMP_NODE);
    expect(snap.context.project_id).toBe(PROJECT);
  });
});

describe("when the browser reports the source was created", () => {
  it("advances the node to uploading, recording the real source id", () => {
    const actor = startFlow();
    actor.send({ type: "source_create_requested", temp_node_id: TEMP_NODE, project_id: PROJECT });
    actor.send({ type: "source_created", source_id: "src-1" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("uploading");
    expect(snap.context.source_id).toBe("src-1");
    // The optimistic node identity is preserved across the advance.
    expect(snap.context.temp_node_id).toBe(TEMP_NODE);
  });
});

describe("when the browser reports the upload started", () => {
  it("advances the node to processing, recording the upload id", () => {
    const actor = startUploading();
    actor.send({ type: "source_upload_started", upload_id: "up-1" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("processing");
    expect(snap.context.upload_id).toBe("up-1");
  });
});

describe("when the browser reports the upload was processed", () => {
  it("links the node to its dataset, settling in linked", () => {
    const actor = startUploading();
    actor.send({ type: "source_upload_started", upload_id: "up-1" });
    actor.send({ type: "source_upload_processed", dataset_id: "ds-1" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("linked");
    expect(snap.context.dataset_id).toBe("ds-1");
    expect(snap.context.source_id).toBe("src-1");
  });
});

describe("when the browser reports the upload failed", () => {
  it("moves the node to a recoverable error from uploading, carrying the reason", () => {
    const actor = startUploading();
    actor.send({ type: "source_upload_failed", reason: "schema_mismatch" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("error_recoverable");
    expect(snap.context.error).toBe("schema_mismatch");
  });

  it("moves the node to a recoverable error from processing, carrying the reason", () => {
    const actor = startUploading();
    actor.send({ type: "source_upload_started", upload_id: "up-1" });
    actor.send({ type: "source_upload_failed", reason: "failed_ingest" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("error_recoverable");
    expect(snap.context.error).toBe("failed_ingest");
  });

  it("lets the browser re-enter the flow from the recoverable error (not a dead end)", () => {
    const actor = startUploading();
    actor.send({ type: "source_upload_failed", reason: "schema_mismatch" });
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    // A reset clears the error and returns to idle so the flow can begin again.
    actor.send({ type: "source_flow_reset" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.error).toBeNull();
  });
});

describe("when the browser resets the flow", () => {
  it("clears all in-flight context back to idle from any phase", () => {
    const actor = startUploading();
    actor.send({ type: "source_upload_started", upload_id: "up-1" });
    actor.send({ type: "source_flow_reset" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.temp_node_id).toBeNull();
    expect(snap.context.source_id).toBeNull();
    expect(snap.context.upload_id).toBeNull();
    expect(snap.context.dataset_id).toBeNull();
    expect(snap.context.project_id).toBeNull();
    expect(snap.context.error).toBeNull();
  });
});
