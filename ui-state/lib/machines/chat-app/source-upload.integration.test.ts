// In-process INTEGRATION tests for the source-upload coordinator over the
// ADR-046 `/state` actor surface — the SOLE read/write surface of the ui-state
// tier. These drive the LIVE ui-state HTTP tier via `app.fetch` (no socket, no
// Redis), exactly as state-router.integration.test.ts does for the org→project
// cascade.
//
// The source-upload child is invoked under `engaged` (a sibling of
// project-context), so it is ALIVE throughout the workspace phase. The browser is
// the saga coordinator: it POSTs past-tense outcome reports to /state/events and
// the `sourceUpload` region of the returned ChatAppStateDocument advances through
// the optimistic node's phases (idle → creating_source → uploading → processing →
// linked). Zero egress — no child invokes a server-side actor.
//
// References:
//   docs/decisions/adr-046-*.md  — StateProxy actor surface
//   docs/decisions/adr-049-*.md  — client-reported outcome-event model

import { describe, expect, it } from "vitest";

import { buildChatAppApp } from "../../../index.ts";
import { createNoopChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import { createNoopFlowEventLog } from "../../persistence/redis.ts";
import type { ChatAppDeps } from "./index.ts";
import type { ChatAppStateDocument } from "./projection/derive-state-document.ts";

const ORG = { id: "org-1", name: "Acme Data" };
const PROJECT_A = { id: "proj-A", name: "Project A" };

function fakeChatAppDeps(): ChatAppDeps {
  return { projectContext: {}, sessionChat: {} };
}

function buildScenario() {
  const app = buildChatAppApp({
    eventLog: createNoopFlowEventLog(),
    snapshotStore: createNoopChatAppSnapshotStore(),
    chatAppDeps: fakeChatAppDeps(),
    logTransition: () => undefined,
  });
  return { app };
}

async function postStateEvent(
  app: ReturnType<typeof buildChatAppApp>,
  body: Record<string, unknown>,
  userId: string,
): Promise<{ status: number; document: ChatAppStateDocument; raw: Record<string, unknown> }> {
  const res = await app.fetch(
    new Request("http://t/state/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-User-Id": userId,
        "X-User-Email": "maya@acme",
        authorization: "Bearer tok",
      },
      body: JSON.stringify(body),
    }),
  );
  const raw = (await res.json()) as Record<string, unknown>;
  return { status: res.status, document: raw as unknown as ChatAppStateDocument, raw };
}

/** Cold-start a principal and drive onboarding → engaged.project_context so the
 *  source-upload child is alive (it is invoked under `engaged`). */
async function reachEngaged(
  app: ReturnType<typeof buildChatAppApp>,
  userId: string,
): Promise<void> {
  await postStateEvent(app, { type: "session_begin" }, userId);
  await postStateEvent(
    app,
    { type: "org_found", payload: { org: ORG } },
    userId,
  );
}

describe("source-upload: the optimistic source node advances through its phases", () => {
  it("cold-starts the sourceUpload region in idle once the workspace is engaged", async () => {
    const { app } = buildScenario();
    await reachEngaged(app, "u1");
    const doc = await postStateEvent(
      app,
      { type: "scope_resolved", payload: { project: PROJECT_A } },
      "u1",
    );
    expect(doc.status).toBe(200);
    expect(doc.document.regions.sourceUpload.phase).toBe("idle");
    expect(doc.document.regions.sourceUpload.temp_node_id).toBeNull();
  });

  it("walks create → upload → process → linked as the browser reports each outcome", async () => {
    const { app } = buildScenario();
    await reachEngaged(app, "u2");

    const created = await postStateEvent(
      app,
      {
        type: "source_create_requested",
        payload: { temp_node_id: "tmp-1", project_id: "proj-A" },
      },
      "u2",
    );
    expect(created.status).toBe(200);
    expect(created.document.regions.sourceUpload.phase).toBe("creating_source");
    expect(created.document.regions.sourceUpload.temp_node_id).toBe("tmp-1");

    const uploading = await postStateEvent(
      app,
      { type: "source_created", payload: { source_id: "src-1" } },
      "u2",
    );
    expect(uploading.document.regions.sourceUpload.phase).toBe("uploading");
    expect(uploading.document.regions.sourceUpload.source_id).toBe("src-1");

    const processing = await postStateEvent(
      app,
      { type: "source_upload_started", payload: { upload_id: "up-1" } },
      "u2",
    );
    expect(processing.document.regions.sourceUpload.phase).toBe("processing");

    const linked = await postStateEvent(
      app,
      { type: "source_upload_processed", payload: { dataset_id: "ds-1" } },
      "u2",
    );
    expect(linked.document.regions.sourceUpload.phase).toBe("linked");
    expect(linked.document.regions.sourceUpload.dataset_id).toBe("ds-1");
    expect(linked.document.regions.sourceUpload.source_id).toBe("src-1");
  });

  it("surfaces a failed upload as a recoverable error carrying the reason", async () => {
    const { app } = buildScenario();
    await reachEngaged(app, "u3");
    await postStateEvent(
      app,
      {
        type: "source_create_requested",
        payload: { temp_node_id: "tmp-1", project_id: "proj-A" },
      },
      "u3",
    );
    await postStateEvent(
      app,
      { type: "source_created", payload: { source_id: "src-1" } },
      "u3",
    );
    const failed = await postStateEvent(
      app,
      { type: "source_upload_failed", payload: { reason: "schema_mismatch" } },
      "u3",
    );
    expect(failed.status).toBe(200);
    expect(failed.document.regions.sourceUpload.phase).toBe("error_recoverable");
    expect(failed.document.regions.sourceUpload.error).toBe("schema_mismatch");
  });
});

describe("source-upload: the closed wire vocabulary still rejects/ignores correctly", () => {
  it("refuses an unmodeled event (400, no-op) even with the new members added", async () => {
    const { app } = buildScenario();
    await reachEngaged(app, "u4");
    const { status } = await postStateEvent(
      app,
      { type: "totally_unknown_source_event", payload: {} },
      "u4",
    );
    expect(status).toBe(400);
  });

  it("drops a known source event posted out of phase without crashing the flow", async () => {
    const { app } = buildScenario();
    // Still in onboarding (login) — the source-upload child is NOT alive yet, so
    // a known source event has no handler on the current phase and XState drops
    // it. The process must stay alive and the onboarding flow unchanged.
    await postStateEvent(app, { type: "session_begin" }, "u5");
    const dropped = await postStateEvent(
      app,
      {
        type: "source_create_requested",
        payload: { temp_node_id: "tmp-1", project_id: "proj-A" },
      },
      "u5",
    );
    expect(dropped.status).toBe(200);
    // The onboarding flow is untouched and the source region is still idle.
    expect(dropped.document.regions.onboarding.state).toBe("awaiting_org_report");
    expect(dropped.document.regions.sourceUpload.phase).toBe("idle");
  });
});
