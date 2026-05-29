// Actions for the ChatApp coordinator statechart.
//
// ROLE — actions are the ONLY writers of machine context AND the parent→child
// forwarders. Two kinds live here:
//   - context writers (`assign`): re-point the active child, and capture a
//     child's hand-off / retained outcome off its snapshot.
//   - forwarders (`enqueueActions` → `sendTo`): deliver a staged hand-off, or
//     route a live intent / raw child-event to whichever child owns the phase.
//
// Both kinds are pinned to the chat-app generics so the heterogeneous bundle is
// assignable to `setup({ actions })`:
//   - the `assign`s share `updateContext` — `assign` with its five generics
//     pinned once via an instantiation expression (no defaults, so all five must
//     be supplied; `TExpressionEvent` and `TEvent` are the same union here),
//     mirroring session-onboarding/setup/actions.ts.
//   - the forwarders share `forward` — `enqueueActions` with the same generics
//     pinned. Pinning `TActor` to `ChatAppActor` (../setup/actors.ts) is what
//     lets the pre-built bundle type-check inside `setup`; without it the
//     entries would carry the generic `ProvidedActor` and be rejected.
//
// `sendTo` target ids: XState types `sendTo`'s target as
// `string | ActorRef | (() => …)` (see node_modules/xstate
// .../actions/send.d.ts `SendToActionTarget`), so a string literal target like
// `"project-context"` is accepted whether the action is defined inline or in
// this bundle; it is never matched against the actor map.
//
// `event` is the FULL declared `ChatAppEvent` union for EVERY action in this
// bundle: `setup` types each named action's expression-event as the whole
// `TEvent`, regardless of which transition references it. So the snapshot/intent
// readers cast `event` to reach the onSnapshot snapshot or the intent payload.

import { assign, enqueueActions } from "xstate";

import type { ChatAppActor } from "./actors.ts";
import {
  onboardingSnapshot,
  projectContextSnapshot,
} from "./snapshot-readers.ts";
import type {
  ChatAppContext,
  ChatAppEvent,
  ChatUserIntent,
} from "./types.ts";

/** A user_intent's payload, read off the live `user_intent` event. */
function intentOf(event: ChatAppEvent): ChatUserIntent {
  return (event as { type: "user_intent"; intent: ChatUserIntent }).intent;
}

const updateContext = assign<
  ChatAppContext,
  ChatAppEvent,
  undefined,
  ChatAppEvent,
  ChatAppActor
>;

// The forwarders pin the SAME leading generics as `updateContext`, plus the four
// trailing generics (TAction / TGuard / TDelay / TEmitted) to `never` — exactly
// what `assign` hardcodes in its return `ActionFunction<…, never, never, never,
// never>`. This is the one extra step the `enqueueActions` half needs over the
// `assign` half: `assign` fixes those four for you, whereas `enqueueActions`
// defaults TAction/TGuard to the wide `ParameterizedObject` and TEmitted to
// `EventObject`. Left at the defaults, each forwarder's `_out_TAction` would be
// the wide `ParameterizedObject`, which is NOT assignable to the self-referential
// `ToParameterizedObject<typeof actions>` that `setup({ actions })` derives from
// this bundle's own keys. Pinning them to `never` (the forwarders enqueue no
// named actions, raise no delays, emit nothing) makes the bundle assignable —
// the precise, narrow reason the forwarders are extractable after all.
const forward = enqueueActions<
  ChatAppContext,
  ChatAppEvent,
  undefined,
  ChatAppEvent,
  ChatAppActor,
  never,
  never,
  never,
  never
>;

export const actions = {
  // ── active-child routing (re-pointed on each phase entry) ──
  markOnboardingActive: updateContext({ active_child_id: "session-onboarding" }),
  markProjectContextActive: updateContext({ active_child_id: "project-context" }),
  markChatActive: updateContext({ active_child_id: "session-chat" }),

  // ── hand-off capture (read the child snapshot, stage the payload) ──
  /** onboarding → project_context: stage org + identity for `auth_ready` AND
   *  retain the full onboarding outcome. The onboarding child is
   *  phase-scoped — it is stopped on this very advance — so its resolved
   *  identity/org must survive into parent context for the derived
   *  `login-and-org-setup` projection to reproduce `ready` byte-identically
   *  once the child is gone. `auth_handoff` keeps its exact prior shape
   *  (org_id + first_name); `onboarding_result` is the additive retention. */
  captureAuthHandoff: updateContext(({ event }) => {
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
  }),
  /** onboarding → user_rejected: retain the rejected outcome (cause + any
   *  validation error) so the derived `login-and-org-setup` projection
   *  reproduces `session_rejected` after the child is stopped. Mirrors
   *  buildProjection's session_rejected fold (user/org stay null; only the
   *  cause carries). The action name reflects the domain outcome (user
   *  rejected); the inner `state` value stays `session_rejected` because
   *  it is the FE/auth-proxy wire-contract string for this projection. */
  captureUserRejected: updateContext(({ event }) => {
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
  }),
  /** project_context → chat (and switch): stage the selected project for
   *  `project_ready` and record it as the last-forwarded id (the
   *  discriminator the guards use to tell first-selection from a switch). */
  captureProjectHandoff: updateContext(({ context, event }) => {
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
  }),

  // ── forwarders (parent → child) ──
  /** entry of the project-context-owning state: deliver staged auth_ready. */
  forwardAuthReady: forward(({ context, enqueue }) => {
    const handoff = context.auth_handoff;
    if (handoff) {
      enqueue.sendTo("project-context", {
        type: "auth_ready",
        org_id: handoff.org_id,
        user: handoff.user,
      });
    }
  }),
  /** entry of chat AND the switch re-forward: deliver staged project_ready. */
  forwardProjectReady: forward(({ context, enqueue }) => {
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
  }),
  /** PROJECT_SWITCH: drive project-context's switch by forwarding its intent. */
  forwardSwitchToProjectContext: forward(({ event, enqueue }) => {
    const switchEvent = event as {
      type: "PROJECT_SWITCH";
      new_project_id: string;
    };
    enqueue.sendTo("project-context", {
      type: "switching_project_intent",
      new_project_id: switchEvent.new_project_id,
    });
  }),
  /** live user_intent: route to whichever child owns the current phase. */
  forwardIntentToActiveChild: forward(({ context, event, enqueue }) => {
    enqueue.sendTo(context.active_child_id, intentOf(event));
  }),
  /** live child_event: forward a raw domain event (the HTTP `/event` transport)
   *  verbatim to whichever child owns the current phase. The child's own event
   *  union decides whether to handle or ignore it (XState v5 ignores unknown
   *  events), so this stays a total forward. */
  forwardChildEventToActiveChild: forward(({ context, event, enqueue }) => {
    const raw = (
      event as {
        type: "child_event";
        child_event: { type: string; payload?: Record<string, unknown> };
      }
    ).child_event;
    enqueue.sendTo(context.active_child_id, {
      type: raw.type,
      ...(raw.payload ?? {}),
    } as never);
  }),
};
