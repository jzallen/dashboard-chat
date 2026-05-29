// ChatAppMachine — the XState v5 PARENT coordinator that cycles
// onboarding → project-context → chat (ADR-044). It supersedes the imperative
// FlowOrchestrator's coordination role (spawn hand-offs, child choreography)
// with a declarative statechart — the first faithful implementation of
// ADR-028's "one root orchestrator actor mediating parent-ignorant children."
//
// SINGLE lifecycle region (one active state at a time):
//
//     onboarding ─(isUserReady)─► project_context ─(isInitialProjectSelected)─► chat
//                 └(isUserRejected)─► user_rejected
//     (project-context is invoked on `engaged`, the ancestor of project_context
//      AND chat, so it stays live for switching while in chat; session-chat is
//      invoked on `chat` only.)
//     Inbound user intents route to whichever child owns the current phase via a
//     top-level `user_intent` handler (forwardIntentToActiveChild).
//
// The parent-level token-lifecycle (freeze/reauth) region was RETIRED (ADR-043):
// auth-proxy owns the token lifecycle (ADR-016), so ui-state is never a
// token-management participant — a backend-401 is an ordinary upstream error,
// not a ui-state "reauth" event. ADR-044 §5 Open Question #2 is hereby resolved
// TOWARD REMOVAL.
//
// COORDINATION (children stay parent-ignorant, ADR-028): the parent watches each
// child via `onSnapshot` and advances on the child's OWN state value; hand-offs
// are parent `entry` actions that `sendTo` the next child (the declarative form
// of the orchestrator's authReady→begin / projectReady pump callbacks).
//
// Children are dependency-injected: the logical actors (./setup/actors.ts) are
// placeholders, swapped via `machine.provide({ actors })` (Phase 1 = fakes,
// Phase 2 = the real machines). See ./README.md.
//
// `types` / `guards` / `actors` are extracted under ./setup/. The ACTIONS are
// inline here: they mix context writers (`assign`) with parent→child forwarders
// (`enqueueActions` → `sendTo`), and a pre-built mixed bundle is not assignable
// to `setup({ actions })` (assign yields TEmitted = never, enqueueActions yields
// EventObject — a heterogeneous object literal). Defining them inline lets setup
// infer each action's actor/event generics directly, which is also where the
// `sendTo` target ids and forwarded-event types are checked.

import { assign, enqueueActions, setup } from "xstate";

import { actors } from "./setup/actors.ts";
import { guards } from "./setup/guards.ts";
import type {
  ChatAppContext,
  ChatAppEvent,
  ChatUserIntent,
  OnboardingSnapshotView,
  ProjectContextSnapshotView,
  SessionOnboardingInput,
} from "./setup/types.ts";

// ── snapshot readers — the parent watches children via onSnapshot; the snapshot
// events are not members of ChatAppEvent, so read them through the narrow views
// (./setup/types.ts), the same cast convention the guards + child machines use. ──
function onboardingSnapshot(event: ChatAppEvent): OnboardingSnapshotView {
  return (event as unknown as { snapshot: OnboardingSnapshotView }).snapshot;
}
function projectContextSnapshot(
  event: ChatAppEvent,
): ProjectContextSnapshotView {
  return (event as unknown as { snapshot: ProjectContextSnapshotView })
    .snapshot;
}
function intentOf(event: ChatAppEvent): ChatUserIntent {
  return (event as { type: "user_intent"; intent: ChatUserIntent }).intent;
}

export function createChatAppMachine() {
  return setup({
    types: {
      context: {} as ChatAppContext,
      events: {} as ChatAppEvent,
      input: {} as SessionOnboardingInput,
    },
    actors,
    guards,
    actions: {
      // ── active-child routing (re-pointed on each phase entry) ──
      markOnboardingActive: assign({ active_child_id: "session-onboarding" }),
      markProjectContextActive: assign({ active_child_id: "project-context" }),
      markChatActive: assign({ active_child_id: "session-chat" }),

      // ── hand-off capture (read the child snapshot, stage the payload) ──
      /** onboarding → project_context: stage org + identity for `auth_ready` AND
       *  retain the full onboarding outcome (ADR-044 §2). The onboarding child is
       *  phase-scoped — it is stopped on this very advance — so its resolved
       *  identity/org must survive into parent context for the derived
       *  `login-and-org-setup` projection to reproduce `ready` byte-identically
       *  once the child is gone. `auth_handoff` keeps its exact prior shape
       *  (org_id + first_name); `onboarding_result` is the additive retention. */
      captureAuthHandoff: assign(({ event }) => {
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
      captureUserRejected: assign(({ event }) => {
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
            underlying_cause_tag:
              snapshot.context.underlying_cause_tag ?? null,
            org_validation_error: snapshot.context.org_validation_error ?? null,
          },
        };
      }),
      /** project_context → chat (and switch): stage the selected project for
       *  `project_ready` and record it as the last-forwarded id (the
       *  discriminator the guards use to tell first-selection from a switch). */
      captureProjectHandoff: assign(({ context, event }) => {
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
      forwardAuthReady: enqueueActions(({ context, enqueue }) => {
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
      forwardProjectReady: enqueueActions(({ context, enqueue }) => {
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
      forwardSwitchToProjectContext: enqueueActions(({ event, enqueue }) => {
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
      forwardIntentToActiveChild: enqueueActions(
        ({ context, event, enqueue }) => {
          enqueue.sendTo(context.active_child_id, intentOf(event));
        },
      ),
      /** live child_event: forward a raw domain event (the HTTP `/event`
       *  transport, ADR-044 Phase 4) verbatim to whichever child owns the
       *  current phase. The cast mirrors the orchestrator's retired
       *  `actor.send({ type: event.type, ...event.payload } as never)` — the
       *  child's own event union decides whether to handle or ignore it
       *  (XState v5 ignores unknown events), so this stays a total forward. */
      forwardChildEventToActiveChild: enqueueActions(
        ({ context, event, enqueue }) => {
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
        },
      ),
    },
  }).createMachine({
    id: "chat-app",
    initial: "onboarding",
    context: ({ input }) => ({
      request_id: input.request_id,
      // Begin envelope — write-once; threaded into each child's invoke input.
      principal_id: input.principal_id,
      bearer_token: input.bearer_token ?? "",
      config: input.config ?? null,
      deps: input.deps ?? null,
      active_child_id: "session-onboarding",
      auth_handoff: null,
      project_handoff: null,
      last_forwarded_project_id: null,
      onboarding_result: null,
    }),
    // Live user intent: route to whichever child owns the current phase. This is
    // the single intent router (ADR-028) — a top-level handler now that the
    // freeze/reauth region is retired (ADR-043); intents are never held.
    on: {
      user_intent: { actions: "forwardIntentToActiveChild" },
      child_event: { actions: "forwardChildEventToActiveChild" },
    },
    states: {
      onboarding: {
        entry: "markOnboardingActive",
        invoke: {
          id: "session-onboarding",
          systemId: "session-onboarding",
          src: "onboarding",
          // Begin envelope → the onboarding child's Input. Its resolvers read
          // the WorkOS/backend URLs + fetch port from `config`/`deps` and the
          // re-verify Bearer from `bearer_token` (session-onboarding/setup/
          // types.ts SessionOnboardingInput).
          input: ({ context }) => ({
            request_id: context.request_id,
            principal_id: context.principal_id,
            bearer_token: context.bearer_token,
            config: context.config,
            deps: context.deps,
          }),
          // Watch the onboarding child; advance on its own state value.
          onSnapshot: [
            {
              guard: "isUserReady",
              target: "engaged",
              actions: "captureAuthHandoff",
            },
            {
              guard: "isUserRejected",
              target: "user_rejected",
              actions: "captureUserRejected",
            },
          ],
        },
      },

      // `engaged` owns the project-context child for BOTH project_context
      // and chat (invoked here so it survives the move into chat, where it
      // still serves project switches).
      engaged: {
        initial: "project_context",
        // Deliver the staged auth_ready to the freshly-invoked child.
        entry: "forwardAuthReady",
        invoke: {
          id: "project-context",
          systemId: "project-context",
          src: "projectContext",
          // Static ids → the project-context child's Input. The dynamic
          // org_id + identity arrive via the `auth_ready` hand-off (forwarded
          // on this state's entry), so the input carries only the immutable
          // request_id/principal_id (project-context's I/O ports are
          // construction-time actors wired in ../index.ts).
          input: ({ context }) => ({
            request_id: context.request_id,
            principal_id: context.principal_id,
          }),
          onSnapshot: [
            // First selection → advance project_context → chat (chat's entry
            // forwards project_ready).
            {
              guard: "isInitialProjectSelected",
              target: ".chat",
              actions: "captureProjectHandoff",
            },
            // Later selection with a changed id → project switch: re-forward
            // project_ready in place (no re-entry of engaged/chat).
            {
              guard: "shouldSwitchProject",
              actions: ["captureProjectHandoff", "forwardProjectReady"],
            },
          ],
        },
        // A project switch drives project-context's own switch path.
        on: {
          PROJECT_SWITCH: { actions: "forwardSwitchToProjectContext" },
        },
        states: {
          project_context: {
            entry: "markProjectContextActive",
          },
          chat: {
            entry: ["markChatActive", "forwardProjectReady"],
            invoke: {
              id: "session-chat",
              systemId: "session-chat",
              src: "sessionChat",
              // Static ids → the session-chat child's Input. The dynamic
              // org_id + project arrive via the `project_ready` hand-off
              // (forwarded on chat entry), so the input carries only the
              // immutable request_id/principal_id (session-chat's I/O ports
              // are construction-time actors wired in ../index.ts).
              input: ({ context }) => ({
                request_id: context.request_id,
                principal_id: context.principal_id,
              }),
            },
          },
        },
      },

      user_rejected: {},
    },
  });
}
