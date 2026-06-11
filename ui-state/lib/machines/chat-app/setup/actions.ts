// Actions for the ChatApp coordinator statechart — the ONLY writers of machine
// context (`assign` closures) and the parent→child forwarders (`enqueueActions`
// closures). Each is a bare, param-annotated closure; the `assign(...)` /
// `enqueueActions(...)` wrap happens at the `setup()` call in ../machine.ts,
// where inference flows from `setup`'s `types`. The closures annotate their param
// with the shared `ActionArgs` / `ForwardArgs` aliases (./types.ts) — no xstate
// generics are pinned here.
//
// `event` is the FULL declared `ChatAppEvent` union for EVERY action: `setup`
// types each named action's expression-event as the whole `TEvent`, regardless of
// which transition references it. The onSnapshot snapshot events are not members
// of that union, so the snapshot/intent readers cast `event` to reach the
// onSnapshot snapshot or the intent payload.

import {
  onboardingSnapshot,
  projectContextSnapshot,
} from "./snapshot-readers.ts";
import type {
  ActionArgs,
  ForwardArgs,
} from "./types.ts";

// ── hand-off capture (read the child snapshot, stage the payload) ──
/** onboarding → project_context: stage org + identity for `auth_ready` AND
 *  retain the full onboarding outcome. The onboarding child is
 *  phase-scoped — it is stopped on this very advance — so its resolved
 *  identity/org must survive into parent context for the derived
 *  `login-and-org-setup` projection to reproduce `ready` byte-identically
 *  once the child is gone. `auth_handoff` keeps its exact prior shape
 *  (org_id + first_name); `onboarding_result` is the additive retention. */
export const captureAuthHandoff = ({ event }: ActionArgs) => {
  const snapshot = onboardingSnapshot(event);
  return {
    auth_handoff: {
      org_id: snapshot.context.org.id ?? "",
      user: { first_name: snapshot.context.user.first_name ?? "" },
    },
    onboarding_result: {
      state: "ready" as const,
      user: {
        email: snapshot.context.user.email ?? null,
        display_name: snapshot.context.user.display_name ?? null,
        first_name: snapshot.context.user.first_name ?? null,
      },
      org: {
        id: snapshot.context.org.id ?? null,
        name: snapshot.context.org.name ?? null,
      },
      underlying_cause_tag: null,
      org_validation_error: null,
    },
  };
};
/** project_context → chat (and switch): stage the selected project for
 *  `project_ready` and record it as the last-forwarded id (the
 *  discriminator the guards use to tell first-selection from a switch). */
export const captureProjectHandoff = ({ context, event }: ActionArgs) => {
  const snapshot = projectContextSnapshot(event);
  const projectId = snapshot.context.project.id ?? "";
  return {
    project_handoff: {
      org_id: context.auth_handoff?.org_id ?? "",
      project_id: projectId,
      project_name: snapshot.context.project.name ?? "",
      request_id: context.request_id,
    },
    last_forwarded_project_id: projectId,
  };
};

// ── forwarders (parent → child) ──
/** entry of the project-context-owning state: deliver staged auth_ready. */
export const forwardAuthReady = ({ context, enqueue }: ForwardArgs) => {
  const handoff = context.auth_handoff;
  if (handoff) {
    enqueue.sendTo("project-context", {
      type: "auth_ready",
      org_id: handoff.org_id,
      user: handoff.user,
    });
  }
};
/** entry of chat AND the switch re-forward: deliver staged project_ready. */
export const forwardProjectReady = ({ context, enqueue }: ForwardArgs) => {
  const handoff = context.project_handoff;
  if (handoff) {
    enqueue.sendTo("session-chat", {
      type: "project_ready",
      org_id: handoff.org_id,
      project_id: handoff.project_id,
      project_name: handoff.project_name,
      request_id: handoff.request_id,
    });
  }
};
// ── phase-gated raw-vocabulary forwarders (CDO-S3 / ADR-049 §4) ──
// Each is wired ONLY on the lifecycle state whose child is alive (login /
// engaged / engaged.chat), so it sends to a FIXED invoke-id that is guaranteed
// live in that state. The event is forwarded VERBATIM — the parent's
// ChatAppEvent member shapes already match what each child reads at top level,
// so there is no envelope (no child_event) to unwrap. An out-of-phase event has
// no handler on the current state → XState drops it (no sendTo, no throw into a
// stopped child — the settled-child crash class is unrepresentable).

/** login.on: forward the onboarding vocabulary to the live onboarding child. */
export const forwardToOnboarding = ({ event, enqueue }: ForwardArgs) => {
  enqueue.sendTo("onboarding", event);
};
/** engaged.on: forward the project-context vocabulary to the live
 *  project-context child (reachable from engaged.chat too — a switch/scope
 *  report). */
export const forwardToProjectContext = ({ event, enqueue }: ForwardArgs) => {
  enqueue.sendTo("project-context", event);
};
/** engaged.chat.on: forward the session vocabulary to the live session-chat
 *  child. */
export const forwardToSessionChat = ({ event, enqueue }: ForwardArgs) => {
  enqueue.sendTo("session-chat", event);
};
