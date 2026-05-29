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
  ChatAppEvent,
  ChatUserIntent,
  ForwardArgs,
} from "./types.ts";

/** A user_intent's payload, read off the live `user_intent` event. */
function intentOf(event: ChatAppEvent): ChatUserIntent {
  return (event as { type: "user_intent"; intent: ChatUserIntent }).intent;
}

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
/** onboarding → user_rejected: retain the rejected outcome (cause + any
 *  validation error) so the derived `login-and-org-setup` projection
 *  reproduces `session_rejected` after the child is stopped. Mirrors
 *  buildProjection's session_rejected fold (user/org stay null; only the
 *  cause carries). The action name reflects the domain outcome (user
 *  rejected); the inner `state` value stays `session_rejected` because
 *  it is the FE/auth-proxy wire-contract string for this projection. */
export const captureUserRejected = ({ event }: ActionArgs) => {
  const snapshot = onboardingSnapshot(event);
  return {
    onboarding_result: {
      state: "session_rejected" as const,
      user: {
        email: snapshot.context.user.email ?? null,
        display_name: snapshot.context.user.display_name ?? null,
        first_name: snapshot.context.user.first_name ?? null,
      },
      org: {
        id: snapshot.context.org.id ?? null,
        name: snapshot.context.org.name ?? null,
      },
      underlying_cause_tag: snapshot.context.underlying_cause_tag ?? null,
      org_validation_error: snapshot.context.org_validation_error ?? null,
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
/** PROJECT_SWITCH: drive project-context's switch by forwarding its intent. */
export const forwardSwitchToProjectContext = ({ event, enqueue }: ForwardArgs) => {
  const switchEvent = event as {
    type: "PROJECT_SWITCH";
    new_project_id: string;
  };
  enqueue.sendTo("project-context", {
    type: "switching_project_intent",
    new_project_id: switchEvent.new_project_id,
  });
};
/** live user_intent: route to whichever child owns the current phase. */
export const forwardIntentToActiveChild = ({
  context,
  event,
  enqueue,
}: ForwardArgs) => {
  enqueue.sendTo(context.active_child_id, intentOf(event));
};
/** live child_event: forward a raw domain event (the HTTP `/event` transport)
 *  verbatim to whichever child owns the current phase. The child's own event
 *  union decides whether to handle or ignore it (XState v5 ignores unknown
 *  events), so this stays a total forward. */
export const forwardChildEventToActiveChild = ({
  context,
  event,
  enqueue,
}: ForwardArgs) => {
  const raw = (
    event as {
      type: "child_event";
      child_event: { type: string; payload?: Record<string, unknown> };
    }
  ).child_event;
  enqueue.sendTo(context.active_child_id, {
    type: raw.type,
    ...(raw.payload ?? {}),
  });
};
