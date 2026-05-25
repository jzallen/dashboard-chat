// Types for the ChatApp coordinator statechart (ADR-044): the parent machine's
// context / event / input shapes, the child hand-off payloads, the events the
// parent FORWARDS into its children, and the typed-arg + snapshot-view aliases
// the extracted guards (./guards.ts) and actions (./actions.ts) annotate with.
//
// ChatApp is a PARENT coordinator with TWO PARALLEL REGIONS (it is in one state
// in EACH at once):
//   - lifecycle    : onboarding → project_context → chat (with rejected)
//   - connectivity : live ⇄ frozen   (orthogonal — applies in ANY phase)
//
// The children are INVOKED (not spawned), phase-scoped, and parent-ignorant
// (ADR-028): no child references another; only the parent watches each via
// `onSnapshot` and forwards hand-offs. This file is type-only and imports
// nothing from machine.ts, so there is no machine ↔ types cycle.

/** The two lifecycle phases observable to a consumer, plus the terminal. */
export type ChatAppLifecycle =
  | "onboarding"
  | "project_context"
  | "chat"
  | "rejected";

/** The orthogonal connectivity overlay (the freeze region). */
export type ChatAppConnectivity = "live" | "frozen";

/** Stable child identities. These are the parent's `invoke` ids / `systemId`s —
 *  the parent's own observability + sendTo handles, NEVER child-to-child
 *  references (ADR-028). */
export type ChatAppChildId =
  | "session-onboarding"
  | "project-context"
  | "session-chat";

// ─────────────────────────── Hand-off payloads ───────────────────────────
// Captured from a child's snapshot when it reaches its readiness state, then
// forwarded into the NEXT child on the parent's entry into the next phase. This
// is the declarative form of the orchestrator's imperative authReady→begin /
// projectReady pump callbacks.

/** onboarding → project_context: the resolved org + identity. Mirrors the
 *  `auth_ready` event the real project-context child consumes. */
export interface AuthHandoff {
  org_id: string;
  user: { first_name: string };
}

/** project_context → chat: the selected project. Mirrors the `project_ready`
 *  event the real session-chat child consumes. */
export interface ProjectHandoff {
  org_id: string;
  project_id: string;
  project_name: string;
  request_id: string;
}

// ─────────────────────── Events the parent FORWARDS ───────────────────────

/** A user intent the parent routes to whichever child is active for the current
 *  phase. While `connectivity = frozen` these are HELD (a parent buffer) and
 *  replayed in order on REAUTH_OK. Kept deliberately small for Phase 1; the
 *  real children's full intent surface lands when they are wired in Phase 2. */
export type ChatUserIntent =
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "refresh_session_list" };

/** The full set of events the parent ever `sendTo`s a child. The child
 *  placeholders (./actors.ts) and the Phase-1 fakes both accept this union so
 *  the parent's static `sendTo` targets type-check. */
export type ChatAppChildEvent =
  | { type: "auth_ready"; org_id: string; user: { first_name: string } }
  | {
      type: "project_ready";
      org_id: string;
      project_id: string;
      project_name: string;
      request_id: string;
    }
  | { type: "switching_project_intent"; new_project_id: string }
  | ChatUserIntent;

// ──────────────────────────── Parent context ────────────────────────────

export interface ChatAppContext {
  request_id: string;
  /** Which child currently receives forwarded user intents — re-pointed on each
   *  lifecycle phase entry. The single intent router (ADR-028) needs this
   *  because forwarding is phase-scoped: onboarding while onboarding, etc. */
  active_child_id: ChatAppChildId;
  /** Captured onboarding hand-off; forwarded as `auth_ready` on entry to the
   *  project-context-owning state. Null until onboarding reaches `ready`. */
  auth_handoff: AuthHandoff | null;
  /** Captured project hand-off; forwarded as `project_ready` on entry to
   *  `chat` AND re-forwarded on a project switch. Null until first selection. */
  project_handoff: ProjectHandoff | null;
  /** The last project id forwarded to session-chat. Discriminates first
   *  selection (advance project_context → chat) from a later switch
   *  (re-forward `project_ready` in place) and makes the same project_selected
   *  snapshot idempotent. */
  last_forwarded_project_id: string | null;
  /** The parent-held buffer: user intents that arrived while `frozen`. Replayed
   *  FIFO to the active child on REAUTH_OK, then cleared. */
  held_events: ChatUserIntent[];
}

// ───────────────────────────── Parent events ─────────────────────────────

export type ChatAppEvent =
  // A user intent to route to the active child (held while frozen).
  | { type: "user_intent"; intent: ChatUserIntent }
  // Atomic project switch (forwarded to project-context as
  // switching_project_intent). Meaningful while engaged (project_context/chat).
  | { type: "PROJECT_SWITCH"; new_project_id: string }
  // Connectivity / reauth. TOKEN_EXPIRED is modeled as a PARENT event any phase
  // can raise — in Phase 2 a child raises it via sendParent on a 401; here the
  // test (or a fake) sends it directly. REAUTH_OK / REAUTH_FAILED are the
  // injectable reauth OUTCOMES (no real WorkOS in Phase 1).
  | { type: "TOKEN_EXPIRED" }
  | { type: "REAUTH_OK" }
  | { type: "REAUTH_FAILED" };

/** Raw machine input (the begin envelope). */
export interface ChatAppInput {
  request_id: string;
}

// ─────────────────── Snapshot views (read at onSnapshot) ───────────────────
// The parent watches each child via `onSnapshot`. The placeholder children
// (./actors.ts) carry a minimal type, so the guards/actions cast the snapshot
// to the narrow slice they read — the same cast convention the child machines
// use for actor-result events. These views name ONLY what the parent reads;
// the real children (Phase 2) are structurally wider but compatible here.

export interface OnboardingSnapshotView {
  value: string;
  context: {
    org: { id: string | null };
    user: { first_name: string | null };
  };
}

export interface ProjectContextSnapshotView {
  value: string;
  context: {
    project: { id: string | null; name: string | null };
  };
}

/** Shared typed-arg shape for the extracted guards + actions, mirroring what
 *  `setup()` infers inline: `{ context, event }` over the declared event union.
 *  The onSnapshot snapshot events are not members of `ChatAppEvent`, so the
 *  snapshot readers cast `event` to `{ snapshot: <View> }` — exactly the cost of
 *  extracting guards/actions out of `setup` (documented in session-onboarding). */
export interface ActionArgs {
  context: ChatAppContext;
  event: ChatAppEvent;
}
export type GuardArgs = ActionArgs;
