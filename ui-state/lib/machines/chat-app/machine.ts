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
// This file is MAPPING ONLY: it wires the setup pieces and lays out the state
// transitions. The pieces live under ./setup/ —
//   - actors.ts          — the child placeholder `actors` bundle + ChatAppActor
//   - guards.ts          — the `guards` bundle (transition predicates)
//   - actions.ts         — the `actions` bundle (context writers + forwarders)
//   - snapshot-readers.ts — the shared onSnapshot readers (guards + actions)
//   - types.ts           — context / event / input / snapshot-view types
// so the statechart below reads as transitions, naming actors/guards/actions by
// string without their definitions inline. The actions bundle — including the
// `enqueueActions` → `sendTo` forwarders — is fully extractable: pinning each
// action's generics to the chat-app Ctx/Evt/Actor (the same instantiation-
// expression technique session-onboarding uses for its assigns) makes the
// heterogeneous bundle assignable to `setup({ actions })`. See ./setup/actions.ts
// for why the prior "sendTo target ids must be checked inline" claim does not
// hold. (chat-app is a pure coordinator with no domain value objects, so there
// is no setup/domain.ts.)

import { setup } from "xstate";

import { actions } from "./setup/actions.ts";
import { actors } from "./setup/actors.ts";
import { guards } from "./setup/guards.ts";
import type {
  ChatAppContext,
  ChatAppEvent,
  SessionOnboardingInput,
} from "./setup/types.ts";

export function createChatAppMachine() {
  return setup({
    types: {
      context: {} as ChatAppContext,
      events: {} as ChatAppEvent,
      input: {} as SessionOnboardingInput,
    },
    actors,
    guards,
    actions,
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
