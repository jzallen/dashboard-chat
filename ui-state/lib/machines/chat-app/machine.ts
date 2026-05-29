// ChatApp coordinator — the XState v5 parent machine cycling login → project_context → chat.
//
//     login ─(isUserReady)─► project_context ─(isInitialProjectSelected)─► chat
//           └(isUserRejected)─► user_rejected
//
// References:
//   docs/decisions/adr-044-*.md  — root orchestrator statechart
//   docs/decisions/adr-028-*.md  — one root actor mediating parent-ignorant children
//   docs/decisions/adr-043-*.md  — token-lifecycle modeling retired from ui-state
//   docs/decisions/adr-016-*.md  — auth-proxy owns the token lifecycle
//   ./README.md                  — state diagram, full ADR list

import { assign, enqueueActions, setup } from "xstate";

import {
  captureAuthHandoff,
  captureProjectHandoff,
  captureUserRejected,
  forwardAuthReady,
  forwardChildEventToActiveChild,
  forwardIntentToActiveChild,
  forwardProjectReady,
  forwardSwitchToProjectContext,
} from "./setup/actions.ts";
import { actors } from "./setup/actors.ts";
import { guards } from "./setup/guards.ts";
import type {
  ChatAppContext,
  ChatAppEvent,
  OnboardingInput,
} from "./setup/types.ts";

export function createChatAppMachine() {
  return setup({
    types: {
      context: {} as ChatAppContext,
      events: {} as ChatAppEvent,
      input: {} as OnboardingInput,
    },
    actors,
    guards,
    actions: {
      markLoginActive: assign({ active_child_id: "onboarding" }),
      markProjectContextActive: assign({ active_child_id: "project-context" }),
      markChatActive: assign({ active_child_id: "session-chat" }),

      captureAuthHandoff: assign(captureAuthHandoff),
      captureUserRejected: assign(captureUserRejected),
      captureProjectHandoff: assign(captureProjectHandoff),

      forwardAuthReady: enqueueActions(forwardAuthReady),
      forwardProjectReady: enqueueActions(forwardProjectReady),
      forwardSwitchToProjectContext: enqueueActions(forwardSwitchToProjectContext),
      forwardIntentToActiveChild: enqueueActions(forwardIntentToActiveChild),
      forwardChildEventToActiveChild: enqueueActions(forwardChildEventToActiveChild),
    },
  }).createMachine({
    id: "chat-app",
    initial: "login",
    context: ({ input }) => ({
      request_id: input.request_id,
      principal_id: input.principal_id,
      bearer_token: input.bearer_token ?? "",
      config: input.config ?? null,
      deps: input.deps ?? null,
      active_child_id: "onboarding",
      auth_handoff: null,
      project_handoff: null,
      last_forwarded_project_id: null,
      onboarding_result: null,
    }),
    on: {
      user_intent: { actions: "forwardIntentToActiveChild" },
      child_event: { actions: "forwardChildEventToActiveChild" },
    },
    states: {
      login: {
        entry: "markLoginActive",
        invoke: {
          id: "onboarding",
          src: "onboarding",
          input: ({ context }) => ({
            request_id: context.request_id,
            principal_id: context.principal_id,
            bearer_token: context.bearer_token,
            config: context.config,
            deps: context.deps,
          }),
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

      engaged: {
        initial: "project_context",
        entry: "forwardAuthReady",
        invoke: {
          id: "project-context",
          src: "projectContext",
          input: ({ context }) => ({
            request_id: context.request_id,
            principal_id: context.principal_id,
          }),
          onSnapshot: [
            {
              guard: "isInitialProjectSelected",
              target: ".chat",
              actions: "captureProjectHandoff",
            },
            {
              guard: "shouldSwitchProject",
              actions: ["captureProjectHandoff", "forwardProjectReady"],
            },
          ],
        },
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
              src: "sessionChat",
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
