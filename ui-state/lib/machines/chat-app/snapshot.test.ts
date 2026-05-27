// Snapshot restart-recovery tests on the REAL wired ChatApp (ADR-044 §C3).
//
// These drive a real wired ChatApp actor through the ChatAppSnapshotStore
// (noop tier — exercises the JSON round-trip) and rehydrate a FRESH wired
// machine from the loaded snapshot, asserting:
//   - settled-state round-trip restores lifecycle/connectivity + child states
//     (the happy hot-restart), with NO spurious re-fire of settled reads;
//   - the parent freeze buffer (held_events) survives a frozen round-trip;
//   - the R3 self-heal: a snapshot taken MID-INVOKE rehydrates and re-fires the
//     in-flight child invoke automatically, settling without recovery code —
//     reproduced here on the real wired ChatApp (the spike used a minimal shape);
//   - the saveChatAppSnapshot settled-state guard SKIPS a mid-transient save.

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
import type {
  LoadSessionListInput,
  LoadSessionListOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionSummary,
} from "../session-chat/index.ts";
import { createChatApp } from "./index.ts";
import type { SessionOnboardingInput } from "./setup/types.ts";
import {
  isSettledForSnapshot,
  loadChatAppSnapshot,
  persistChatApp,
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
  loadCalls: string[];
  resumeCalls: string[];
}
function recorder(): Recorder {
  return { loadCalls: [], resumeCalls: [] };
}

/** A hand-resolved resume promise so a test can park session-chat in
 *  `resuming_session` (a transient invoke state) at snapshot time. */
function heldResume() {
  let resolve!: (out: ResumeSessionOutput) => void;
  const promise = new Promise<ResumeSessionOutput>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeDeps(
  rec: Recorder,
  sessions: SessionSummary[],
  held?: { promise: Promise<ResumeSessionOutput> },
) {
  return {
    projectContext: {
      resolveInitialScope: fromPromise<ResolveInitialScopeOutput, ResolveInitialScopeInput>(
        async () => ({ project: PROJECT_A }),
      ),
      createProject: fromPromise<ProjectSummary, CreateProjectInput>(async () => PROJECT_A),
    },
    sessionChat: {
      loadSessionList: fromPromise<LoadSessionListOutput, LoadSessionListInput>(
        async ({ input }) => {
          rec.loadCalls.push(input.project_id);
          return {
            items: sessions,
            next_cursor: null,
            has_more: false,
            resume_target: input.pending_resume_session_id ?? null,
          };
        },
      ),
      resumeSession: fromPromise<ResumeSessionOutput, ResumeSessionInput>(
        async ({ input }) => {
          rec.resumeCalls.push(input.session_id);
          if (held) return held.promise;
          return { session_id: input.session_id, transcript: [], active_dataset_id: null };
        },
      ),
    },
  };
}

function makeInput(): SessionOnboardingInput {
  return {
    request_id: "R-snap",
    principal_id: PRINCIPAL,
    bearer_token: "tok-maya",
    config: makeTestConfig(),
    deps: { request_client: makeMockFetch({ profile: PROFILE, existingOrg: ORG }) },
  };
}

// ── snapshot readers (same convention as the integration suite) ──
type Actor = AnyActorRef;
function valueOf(actor: Actor): { lifecycle: unknown; connectivity: unknown } {
  return actor.getSnapshot().value as { lifecycle: unknown; connectivity: unknown };
}
function childState(actor: Actor, id: string): string | undefined {
  const children = actor.getSnapshot().children as Record<string, AnyActorRef>;
  const snap = children[id]?.getSnapshot() as { value?: unknown } | undefined;
  return snap ? (snap.value as string) : undefined;
}
function held(actor: Actor): unknown[] {
  return (actor.getSnapshot().context as { held_events: unknown[] }).held_events;
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

async function arriveAtChat(
  sessions: SessionSummary[] = [session("s1")],
  held?: { promise: Promise<ResumeSessionOutput> },
) {
  const rec = recorder();
  const actor = createActor(createChatApp(makeDeps(rec, sessions, held)), {
    input: makeInput(),
  }).start();
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

    expect(valueOf(restored).lifecycle).toEqual({ engaged: "chat" });
    expect(valueOf(restored).connectivity).toBe("live");
    expect(childState(restored, "project-context")).toBe("project_selected");
    expect(childState(restored, "session-chat")).toBe("session_list_loaded");
    // The retained onboarding outcome survives the restart (state-of-record).
    expect(
      (restored.getSnapshot().context as { onboarding_result: { state: string } | null })
        .onboarding_result?.state,
    ).toBe("ready");
    // A SETTLED child is NOT re-invoked on rehydration (R3 E4) — no read re-fires.
    expect(rec2.loadCalls).toEqual([]);

    restored.stop();
  });

  it("preserves the parent freeze buffer (held_events) across a frozen round-trip", async () => {
    const { actor } = await arriveAtChat([session("s1"), session("s2")]);
    actor.send({ type: "TOKEN_EXPIRED" });
    actor.send({ type: "user_intent", intent: { type: "session_clicked", session_id: "s1" } });
    expect(valueOf(actor).connectivity).toBe("frozen");
    expect(held(actor)).toHaveLength(1);

    // Children are settled (chat steady state) even while the overlay is frozen.
    const store = createNoopChatAppSnapshotStore();
    expect(await saveChatAppSnapshot(store, PRINCIPAL, actor)).toBe(true);
    actor.stop();

    const rec2 = recorder();
    const loaded = await loadChatAppSnapshot(store, PRINCIPAL);
    const restored = rehydrateChatApp(
      createChatApp(makeDeps(rec2, [session("s1"), session("s2")])) as AnyStateMachine,
      loaded,
    );

    expect(valueOf(restored).connectivity).toBe("frozen");
    expect(held(restored)).toEqual([{ type: "session_clicked", session_id: "s1" }]);

    restored.stop();
  });
});

// ═════════════════════════ R3 self-heal (mid-invoke) ═════════════════════════

describe("ChatApp snapshot — R3 self-heal of an in-flight child invoke", () => {
  it("skips a mid-transient save (settled-state guard)", async () => {
    const heldP = heldResume();
    const { actor } = await arriveAtChat([session("s1")], heldP);
    actor.send({ type: "user_intent", intent: { type: "session_clicked", session_id: "s1" } });
    await waitFor(actor, () => childState(actor, "session-chat") === "resuming_session");

    expect(isSettledForSnapshot(actor.getSnapshot())).toBe(false);
    const store = createNoopChatAppSnapshotStore();
    expect(await saveChatAppSnapshot(store, PRINCIPAL, actor)).toBe(false);
    expect(await loadChatAppSnapshot(store, PRINCIPAL)).toBeNull();

    heldP.resolve({ session_id: "s1", transcript: [], active_dataset_id: null });
    actor.stop();
  });

  it("rehydrates a snapshot taken mid-resuming_session and SELF-HEALS to session_active", async () => {
    const heldP = heldResume();
    const { actor, rec } = await arriveAtChat([session("s1")], heldP);
    actor.send({ type: "user_intent", intent: { type: "session_clicked", session_id: "s1" } });
    await waitFor(actor, () => childState(actor, "session-chat") === "resuming_session");
    expect(rec.resumeCalls).toEqual(["s1"]); // live invoke fired once

    // Deliberately capture the snapshot MID-INVOKE (a crash mid-transition) and
    // round-trip it through the store's JSON path.
    const store = createNoopChatAppSnapshotStore();
    await store.save(PRINCIPAL, persistChatApp(actor));
    actor.stop(); // abandon the live (still-pending) resume promise

    // Fresh process with a NON-held resumeSession: the re-fired invoke settles.
    const rec2 = recorder();
    const loaded = await loadChatAppSnapshot(store, PRINCIPAL);
    const restored = rehydrateChatApp(
      createChatApp(makeDeps(rec2, [session("s1")])) as AnyStateMachine,
      loaded,
    );

    // Restored mid-flight...
    expect(childState(restored, "session-chat")).toBe("resuming_session");
    // ...and the invoke RE-FIRES on rehydration (R3) — resumeSession runs again,
    // reading the persisted pending_resume_session_id, and self-heals.
    await waitFor(restored, () => childState(restored, "session-chat") === "session_active");
    expect(rec2.resumeCalls).toEqual(["s1"]); // re-fired on the fresh process
    expect(
      (restored.getSnapshot().children as Record<string, AnyActorRef>)["session-chat"]
        .getSnapshot().context.session_id,
    ).toBe("s1");

    restored.stop();
  });
});
