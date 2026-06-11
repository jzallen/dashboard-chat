// Snapshot restart-recovery tests on the REAL wired ChatApp.
//
// REPORT-DRIVEN session-chat (ADR-050 §e.5 / DR-8/AR-8): the four egress
// invokes (loadSessionList / resumeSession / createSessionEagerly /
// switchDatasetContext) were DELETED — the region now SETTLES the instant it is
// reached and transitions on client-reported outcomes. So the old R3 self-heal
// tests that captured a snapshot MID-resuming_session (a transient invoke that
// no longer exists) are retired with the egress they exercised. What remains:
//   - settled-state round-trip restores the lifecycle value + child states
//     (the happy hot-restart);
//   - the new invariant: a session-chat region in any state is ALWAYS settled
//     (no transient invoke survives), so saveChatAppSnapshot never skips on its
//     account.

import { describe, expect, it } from "vitest";
import {
  type AnyActorRef,
  type AnyStateMachine,
  createActor,
  fromPromise,
} from "xstate";

import { createNoopChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import type {
  CreateProjectInput,
  ProjectSummary,
  ResolveInitialScopeInput,
  ResolveInitialScopeOutput,
} from "../project-context/index.ts";
import type { SessionSummary } from "../session-chat/index.ts";
import { createChatApp } from "./index.ts";
import type { OnboardingInput } from "./setup/types.ts";
import {
  isSettledForSnapshot,
  loadChatAppSnapshot,
  rehydrateChatApp,
  saveChatAppSnapshot,
} from "./snapshot.ts";

// ───────────────────────────── fixtures ─────────────────────────────

const PRINCIPAL = "dev-user-001";
const ORG = { id: "org-acme", name: "Acme Data" };
const PROFILE = { email: "maya.chen@acme-data.example", name: "Maya Chen" };
const PROJECT_A: ProjectSummary = { id: "proj-A", name: "Project A" };

function session(id: string): SessionSummary {
  return { id, title: id.toUpperCase(), last_active_at: "2026-05-01T02:00:00Z", active_dataset_id: null };
}

interface Recorder {
  switchCalls: string[];
}
function recorder(): Recorder {
  return { switchCalls: [] };
}

function makeDeps(_rec: Recorder, _sessions: SessionSummary[]) {
  return {
    projectContext: {
      resolveInitialScope: fromPromise<ResolveInitialScopeOutput, ResolveInitialScopeInput>(
        async () => ({ project: PROJECT_A }),
      ),
      createProject: fromPromise<ProjectSummary, CreateProjectInput>(async () => PROJECT_A),
    },
    // Report-driven session-chat (ADR-050 §e.5 / DR-8) invokes no actors.
    sessionChat: {},
  };
}

function makeInput(): OnboardingInput {
  return {
    request_id: "R-snap",
    principal_id: PRINCIPAL,
    bearer_token: "tok-maya",
    config: makeTestConfig(),
    // Identity seeded from input (INV-PCO single writer) — the onboarding child
    // no longer re-verifies via fetch; it settles in awaiting_org_report and
    // advances on the client's org report (see arriveAtChat).
    user: { email: PROFILE.email, display_name: PROFILE.name, first_name: "Maya" },
    deps: { request_client: makeMockFetch({ profile: PROFILE, existingOrg: ORG }) },
  };
}

// ── snapshot readers (same convention as the integration suite) ──
type Actor = AnyActorRef;
function valueOf(actor: Actor): unknown {
  return actor.getSnapshot().value;
}
function childState(actor: Actor, id: string): string | undefined {
  const children = actor.getSnapshot().children as Record<string, AnyActorRef>;
  const snap = children[id]?.getSnapshot() as { value?: unknown } | undefined;
  return snap ? (snap.value as string) : undefined;
}

async function waitFor(actor: Actor, pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() >= deadline) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 2);
    };
    tick();
  });
}

async function arriveAtChat(sessions: SessionSummary[] = [session("s1")]) {
  const rec = recorder();
  const actor = createActor(createChatApp(makeDeps(rec, sessions)), {
    input: makeInput(),
  }).start();
  // Client-reported model + phase-gated routing (CDO-S3): report the returning
  // user's org RAW through the parent so login.on forwards org_found to the live
  // onboarding child → ready → engaged.project_context.
  actor.send({ type: "org_found", org: ORG });
  // Then report the resolved project scope so engaged.on forwards scope_resolved
  // to project-context → project_selected → engaged.chat.
  await waitFor(actor, () => childState(actor, "project-context") === "awaiting_scope_report");
  actor.send({ type: "scope_resolved", project: PROJECT_A });
  await waitFor(actor, () => childState(actor, "session-chat") === "awaiting_session_list_report");
  // Report-driven session-chat (ADR-050 §e.5 / DR-8): the client reports the
  // probed list THROUGH THE PARENT → session_list_loaded.
  actor.send({ type: "session_list_loaded", sessions, next_cursor: null, has_more: false });
  await waitFor(actor, () => childState(actor, "session-chat") === "session_list_loaded");
  return { actor, rec };
}

// ═════════════════════════ settled round-trip ═════════════════════════

describe("ChatApp snapshot — settled-state hot restart", () => {
  it("round-trips a chat-steady-state actor through the store and restores it", async () => {
    const { actor } = await arriveAtChat();
    expect(isSettledForSnapshot(actor.getSnapshot())).toBe(true);

    const store = createNoopChatAppSnapshotStore();
    const saved = await saveChatAppSnapshot(store, PRINCIPAL, actor);
    expect(saved).toBe(true);
    actor.stop();

    // Fresh process: a new wired machine + fresh ports, rehydrated from the store.
    const rec2 = recorder();
    const loaded = await loadChatAppSnapshot(store, PRINCIPAL);
    expect(loaded).not.toBeNull();
    const restored = rehydrateChatApp(
      createChatApp(makeDeps(rec2, [session("s1")])) as AnyStateMachine,
      loaded,
    );

    expect(valueOf(restored)).toEqual({ engaged: "chat" });
    expect(childState(restored, "project-context")).toBe("project_selected");
    expect(childState(restored, "session-chat")).toBe("session_list_loaded");
    // The retained onboarding outcome survives the restart (state-of-record).
    expect(
      (restored.getSnapshot().context as { onboarding_result: { state: string } | null })
        .onboarding_result?.state,
    ).toBe("ready");
    // The restored session-chat region carries the reported list (no egress
    // re-fires on a settled rehydration).
    expect(
      (restored.getSnapshot().children as Record<string, AnyActorRef>)["session-chat"]
        .getSnapshot().context.session_list,
    ).toEqual([session("s1")]);

    restored.stop();
  });
});

// ═════════════════════════ report-driven settle invariant ═════════════════════════
// The R3 self-heal tests that snapshotted MID-resuming_session are retired: under
// the report-driven model (DR-8) session-chat invokes nothing, so there is no
// transient invoke state to capture mid-flight. The replacement invariant proves
// that the report-driven waiting state is ALWAYS settled — a snapshot taken there
// is safe to persist (saveChatAppSnapshot never skips on session-chat's account).

describe("ChatApp snapshot — report-driven session-chat always settles", () => {
  it("awaiting_session_list_report is a SETTLED state — a snapshot there persists (no transient invoke)", async () => {
    const rec = recorder();
    const actor = createActor(createChatApp(makeDeps(rec, [session("s1")])), {
      input: makeInput(),
    }).start();
    actor.send({ type: "org_found", org: ORG });
    await waitFor(actor, () => childState(actor, "project-context") === "awaiting_scope_report");
    actor.send({ type: "scope_resolved", project: PROJECT_A });
    // Park session-chat in the report-waiting state WITHOUT reporting the list.
    await waitFor(actor, () => childState(actor, "session-chat") === "awaiting_session_list_report");

    // No transient invoke is in flight — the actor is settled and persists.
    expect(isSettledForSnapshot(actor.getSnapshot())).toBe(true);
    const store = createNoopChatAppSnapshotStore();
    expect(await saveChatAppSnapshot(store, PRINCIPAL, actor)).toBe(true);
    actor.stop();

    // Rehydration restores the waiting state directly — nothing re-fires, and a
    // subsequent client report drives it forward.
    const rec2 = recorder();
    const loaded = await loadChatAppSnapshot(store, PRINCIPAL);
    expect(loaded).not.toBeNull();
    const restored = rehydrateChatApp(
      createChatApp(makeDeps(rec2, [session("s1")])) as AnyStateMachine,
      loaded,
    );
    expect(childState(restored, "session-chat")).toBe("awaiting_session_list_report");

    restored.send({ type: "session_list_loaded", sessions: [session("s1")], next_cursor: null, has_more: false });
    await waitFor(restored, () => childState(restored, "session-chat") === "session_list_loaded");
    expect(
      (restored.getSnapshot().children as Record<string, AnyActorRef>)["session-chat"]
        .getSnapshot().context.session_list,
    ).toEqual([session("s1")]);

    restored.stop();
  });
});
