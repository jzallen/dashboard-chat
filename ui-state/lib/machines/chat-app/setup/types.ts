// Types for the ChatApp coordinator statechart: the parent machine's
// context / event / input shapes, the child hand-off payloads, the events the
// parent FORWARDS into its children, and the typed-arg + snapshot-view aliases
// the extracted guards (./guards.ts) and actions (./actions.ts) annotate with.
//
// ChatApp is a PARENT coordinator with a SINGLE lifecycle region:
//   - lifecycle : login → project_context → chat (with user_rejected)
//
// auth-proxy owns the token lifecycle, so ui-state never participates in token
// management — a backend-401 is an ordinary upstream error, not a ui-state
// "reauth" event.
//
// The children are INVOKED (not spawned), phase-scoped, and parent-ignorant: no
// child references another; only the parent watches each via `onSnapshot` and
// forwards hand-offs. This file is type-only and imports nothing from
// machine.ts, so there is no machine ↔ types cycle.
//
// It imports the three I/O-contract types the onboarding child publishes for its
// composition root — the env `Config`, the `OnboardingDeps` fetch-port
// bundle, and `OnboardingInput` (the begin envelope the parent's
// `types.input` pins against, because the parent's only cold-start path
// bootstraps into onboarding). project-context + session-chat take their I/O
// ports as construction-time actors instead (wired in ../index.ts). These are
// type-only imports of a child's public contract, not a machine importing
// another machine — the parent is the composition root for its children.
//
// References:
//   docs/decisions/adr-044-*.md  — coordinator statechart
//   docs/decisions/adr-028-*.md  — parent-ignorant children
//   docs/decisions/adr-043-*.md  — token-lifecycle modeling retired from ui-state
//   docs/decisions/adr-016-*.md  — auth-proxy owns the token lifecycle

import type { Config } from "../../../../config.ts";
import type {
  OnboardingDeps,
  OnboardingInput,
} from "../../onboarding/index.ts";

// Re-export so external callers of chat-app can name the parent's input by
// importing from this directory; the canonical declaration lives in
// onboarding.
export type { OnboardingInput };

/** The lifecycle phases observable to a consumer, plus the terminal. */
export type ChatAppLifecycle =
  | "login"
  | "project_context"
  | "chat"
  | "user_rejected";

/** Stable child identities. These are the parent's `invoke` ids — the parent's
 *  own observability + sendTo handles (resolved via `snapshot.children[id]`),
 *  NEVER child-to-child references. (`systemId` is unused: it only matters for
 *  cross-hierarchy `system.get(systemId)`, which this design does not use.) */
export type ChatAppChildId =
  | "onboarding"
  | "project-context"
  | "session-chat";

// ─────────────────────────── Hand-off payloads ───────────────────────────
// Captured from a child's snapshot when it reaches its readiness state, then
// forwarded into the NEXT child on the parent's entry into the next phase.

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

/**
 * The RETAINED onboarding outcome — the actor is the state-of-record. The
 * onboarding child is phase-scoped: its invoke lives on the `onboarding`
 * lifecycle state, so XState STOPS it the moment the parent advances to
 * `engaged` (or `user_rejected`) and it disappears from the snapshot. But the FE
 * root loader reads the `/state` document's `regions.onboarding` slice on EVERY
 * request — including deep in chat — so its resolved identity/org (and, on the
 * reject path, the cause) must survive the child's stop. The parent captures it
 * here on the SAME onSnapshot transition that advances/rejects, so
 * `deriveOnboarding` can reproduce the onboarding region byte-identically once
 * the child is gone.
 *
 * The field shapes mirror what `buildProjection` folds into the onboarding
 * region's `context` (user / org / underlying_cause_tag / org_validation_error),
 * so the derived view matches the log fold.
 */
export interface OnboardingResult {
  /** The onboarding child's terminal state at hand-off → the projection `state`
   *  the login-and-org-setup view reports once the child is stopped. */
  state: "ready" | "session_rejected";
  user: {
    email: string | null;
    display_name: string | null;
    first_name: string | null;
  };
  org: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  org_validation_error: { kind: string; message: string } | null;
}

// ─────────────────────── Events the parent FORWARDS ───────────────────────

/** A user intent the parent routes to whichever child is active for the current
 *  phase. */
export type ChatUserIntent =
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "refresh_session_list" };

/** The full set of events the parent ever `sendTo`s a child. The child
 *  placeholders (./actors.ts) and the test fakes both accept this union so the
 *  parent's static `sendTo` targets type-check. */
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

  // ── begin envelope (write-once; seeded from OnboardingInput — the
  //    parent's only cold-start path bootstraps into onboarding — threaded
  //    into each child's invoke `input:` mapper) ──
  // The static per-request identity + I/O ports each child needs at construction.
  // Per-flow DYNAMIC data still arrives via the hand-off events (org binding via
  // `auth_ready`, project via `project_ready`); this envelope carries only the
  // immutable ids/config/ports. NOTE: `config` + `deps` feed the ONBOARDING child
  // (its resolvers read the WorkOS/backend URLs + fetch port from input);
  // project-context + session-chat take their I/O ports as construction-time
  // actors (wired in ../index.ts), so they read only `request_id`/`principal_id`
  // from input.
  /** The verified principal (auth-proxy X-User-Id) — every child's input. */
  principal_id: string;
  /** Verified identity seeded at cold-start from the auth-proxy headers
   *  (X-User-Email → email; display_name/first_name null, no header). Threaded
   *  into the onboarding child's invoke input as its single identity seed
   *  (INV-PCO: one writer). Mirrors OnboardingInput.user. */
  user: {
    email: string | null;
    display_name: string | null;
    first_name: string | null;
  };
  /** The forwarded Bearer the onboarding child re-verifies against WorkOS. */
  bearer_token: string;
  /** Env config (workosUrl/backendUrl + dev header fixture) for the onboarding
   *  child's re-verify + org-create resolvers. Null in tests that stub I/O. */
  config: Config | null;
  /** The fetch I/O port (request_client) the onboarding child's resolvers call.
   *  Mirrors `config`'s nullable + fail-fast pattern. Null in stubbed tests. */
  deps: OnboardingDeps | null;

  /** Which child currently receives forwarded user intents — re-pointed on each
   *  lifecycle phase entry. The single intent router needs this because
   *  forwarding is phase-scoped: onboarding while onboarding, etc. */
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
  /** The RETAINED onboarding outcome — the state-of-record for the
   *  `login-and-org-setup` derived projection once the phase-scoped onboarding
   *  child is stopped (it leaves the snapshot on the advance to `engaged` /
   *  `user_rejected`). Captured on the onSnapshot transition that ends onboarding;
   *  null until then (while onboarding is live the mapper reads the child
   *  directly). See OnboardingResult. */
  onboarding_result: OnboardingResult | null;
}

// ───────────────────────────── Parent events ─────────────────────────────

export type ChatAppEvent =
  // A user intent to route to the active child.
  | { type: "user_intent"; intent: ChatUserIntent }
  // Atomic project switch (forwarded to project-context as
  // switching_project_intent). Meaningful while engaged (project_context/chat).
  | { type: "PROJECT_SWITCH"; new_project_id: string }
  // A raw domain event to forward verbatim to whichever child owns the current
  // phase. This is the HTTP `/event` transport seam: the live app validates the
  // inbound wire event at its boundary, then hands the `{type, payload}` to the
  // parent, which forwards it to `active_child_id` (onboarding while onboarding,
  // project-context while project_context, session-chat while chat). The parent
  // stays the sole router; the child's own event union decides whether the event
  // is handled or ignored (XState v5 ignores unknowns).
  | {
      type: "child_event";
      child_event: { type: string; payload?: Record<string, unknown> };
    };

// ─────────────────── Per-child machine-input contracts ───────────────────
// Each child slot pins its OWN input shape — what the parent's `invoke.input`
// mapper for that slot is allowed to produce, and what the real child reads on
// construction. The three placeholders (./actors.ts) declare their `types.input`
// against the matching type here, so each `invoke.input` mapper in machine.ts
// type-checks against its slot's contract specifically (no cross-slot field
// leakage). The placeholders are swapped for the real machines via
// `.provide({ actors })`; the per-slot input shape stays pinned across the swap.
//
// The onboarding slot's contract is `OnboardingInput` re-exported from
// the real machine — there is only one onboarding input shape, and the slot
// uses it directly. The other two slots declare local interfaces because the
// real project-context and session-chat machines don't yet publish named input
// types; the locals here are deliberately a strict subset of (or aligned with)
// what the real machines accept.

/** Input contract for the `projectContext` slot — aligns with the real
 *  `project-context` machine's input. The dynamic `org_id` + first-name arrive
 *  via the `auth_ready` hand-off (so the parent's current mapper carries only
 *  the static ids), but the slot's contract still accepts what the real child
 *  reads on construction. */
export interface ProjectContextInput {
  request_id: string;
  principal_id: string;
  org_id?: string;
  user?: { first_name?: string };
  deeplink_project_id?: string;
}

/** Input contract for the `sessionChat` slot — aligns with the real
 *  `session-chat` machine's input. The dynamic `org_id` + project arrive via
 *  the `project_ready` hand-off (so the parent's current mapper carries only
 *  the static ids), but the slot's contract still accepts what the real child
 *  reads on construction. */
export interface SessionChatInput {
  request_id: string;
  principal_id: string;
  org_id?: string;
  project_id?: string;
  project_name?: string;
  deeplink_session_id?: string | null;
}

// ─────────────────── Snapshot views (read at onSnapshot) ───────────────────
// The parent watches each child via `onSnapshot`. The placeholder children
// (./actors.ts) carry a minimal type, so the guards/actions cast the snapshot
// to the narrow slice they read — the same cast convention the child machines
// use for actor-result events. These views name ONLY what the parent reads;
// the real children are structurally wider but compatible here.

export interface OnboardingSnapshotView {
  value: string;
  context: {
    // Names more than the hand-off's org.id + user.first_name so the
    // onboarding-outcome capture (machine.ts captureAuthHandoff /
    // captureUserRejected) can RETAIN the full slice the derived
    // login-and-org-setup projection reproduces (org name, full user, the
    // reject cause + any inline org-validation error). The real onboarding
    // child's context is structurally wider; this view names only what is read.
    org: { id: string | null; name: string | null };
    user: {
      email: string | null;
      display_name: string | null;
      first_name: string | null;
    };
    underlying_cause_tag: string | null;
    org_validation_error: { kind: string; message: string } | null;
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
 *  extracting guards/actions out of `setup` (documented in onboarding). */
export interface ActionArgs {
  context: ChatAppContext;
  event: ChatAppEvent;
}
export type GuardArgs = ActionArgs;

/** Arg shape for the parent→child forwarders. Extends `ActionArgs` with a
 *  STRUCTURAL `enqueue` — just the `sendTo` the forwarders call — so the
 *  closures need no xstate generics; `enqueueActions(...)` at the `setup()` site
 *  (../machine.ts) supplies the real, fully-typed `enqueue`. The forwarded event
 *  is typed `unknown` (each child's own event union decides handling), the same
 *  effect the inline forwarders had with `as never`. */
export interface ForwardArgs extends ActionArgs {
  enqueue: { sendTo: (target: string, ev: unknown) => void };
}
