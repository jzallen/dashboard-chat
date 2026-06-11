// ChatApp coordinator — the XState v5 parent machine cycling login → project_context → chat.
//
//     login ─(isUserReady)─► engaged{ project_context ─(isInitialProjectSelected)─► chat }
//
// PHASE-GATED VOCABULARY ROUTING (CDO-S3 / ADR-049 §4 — Option 1). The parent
// declares the finite vocabulary it routes on the lifecycle state whose child is
// ALIVE: onboarding vocab on `login`, project-context vocab on `engaged`
// (reachable from chat too), session vocab on `engaged.chat`. There is NO
// root-level total forward and NO `active_child_id` indirection — an out-of-phase
// KNOWN event has no handler on the current state, so XState DROPS it (no sendTo
// into a stopped phase-scoped child → the 2026-06-10 settled-child process death
// is unrepresentable; domain-model §6 Option 1). The terminal `user_rejected`
// state retired with the client-reported onboarding model (no server re-verify).
//
// References:
//   docs/decisions/adr-049-*.md  — §4 phase-gated vocabulary routing (Option 1)
//   docs/decisions/adr-044-*.md  — root orchestrator statechart
//   docs/decisions/adr-028-*.md  — one root actor mediating parent-ignorant children
//   docs/decisions/adr-043-*.md  — token-lifecycle modeling retired from ui-state
//   docs/decisions/adr-016-*.md  — auth-proxy owns the token lifecycle
//   ./README.md                  — state diagram, full ADR list

import { assign, enqueueActions, setup } from "xstate";

import {
  captureAuthHandoff,
  captureProjectHandoff,
  forwardAuthReady,
  forwardProjectReady,
  forwardToOnboarding,
  forwardToProjectContext,
  forwardToSessionChat,
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
      captureAuthHandoff: assign(captureAuthHandoff),
      captureProjectHandoff: assign(captureProjectHandoff),

      forwardAuthReady: enqueueActions(forwardAuthReady),
      forwardProjectReady: enqueueActions(forwardProjectReady),
      forwardToOnboarding: enqueueActions(forwardToOnboarding),
      forwardToProjectContext: enqueueActions(forwardToProjectContext),
      forwardToSessionChat: enqueueActions(forwardToSessionChat),
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
      // Identity seeded once from the cold-start input (the verified header);
      // threaded into the onboarding child's invoke input below.
      user: input.user ?? { email: null, display_name: null, first_name: null },
      auth_handoff: null,
      project_handoff: null,
      last_forwarded_project_id: null,
      onboarding_result: null,
    }),
    states: {
      login: {
        // Onboarding vocabulary is routed ONLY here — the onboarding child is
        // alive only on `login`. The fixed invoke id is the sendTo target.
        on: {
          org_found: { actions: "forwardToOnboarding" },
          org_not_found: { actions: "forwardToOnboarding" },
          org_created: { actions: "forwardToOnboarding" },
          org_create_failed: { actions: "forwardToOnboarding" },
          __force_failure__: { actions: "forwardToOnboarding" },
        },
        invoke: {
          id: "onboarding",
          src: "onboarding",
          input: ({ context }) => ({
            request_id: context.request_id,
            principal_id: context.principal_id,
            bearer_token: context.bearer_token,
            config: context.config,
            deps: context.deps,
            // Cold-start identity seed (INV-PCO: the onboarding child's single
            // writer of context.user).
            user: context.user,
          }),
          onSnapshot: {
            guard: "isUserReady",
            target: "engaged",
            actions: "captureAuthHandoff",
          },
        },
      },

      engaged: {
        initial: "project_context",
        entry: "forwardAuthReady",
        // Project-context vocabulary is routed on `engaged` (NOT
        // engaged.project_context) so a switch/scope report reaches the
        // project-context child even while session-chat is the active sub-child.
        on: {
          scope_resolved: { actions: "forwardToProjectContext" },
          no_projects_found: { actions: "forwardToProjectContext" },
          project_created: { actions: "forwardToProjectContext" },
          project_create_failed: { actions: "forwardToProjectContext" },
          scope_mismatch: { actions: "forwardToProjectContext" },
          project_switched: { actions: "forwardToProjectContext" },
          open_deep_link: { actions: "forwardToProjectContext" },
          back_to_projects_clicked: { actions: "forwardToProjectContext" },
        },
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
        states: {
          project_context: {},
          chat: {
            entry: "forwardProjectReady",
            // Session vocabulary is routed ONLY here — the session-chat child is
            // alive only on engaged.chat.
            on: {
              session_clicked: { actions: "forwardToSessionChat" },
              new_session_clicked: { actions: "forwardToSessionChat" },
              first_message_sent: { actions: "forwardToSessionChat" },
              refresh_session_list: { actions: "forwardToSessionChat" },
              dataset_resolved_by_agent: { actions: "forwardToSessionChat" },
              dataset_picked_directly: { actions: "forwardToSessionChat" },
              suggestion_chip_clicked_upload: { actions: "forwardToSessionChat" },
              suggestion_chip_clicked_browse_projects: {
                actions: "forwardToSessionChat",
              },
              // ── client-reported session-chat OUTCOME reports (ADR-050 §e.5 /
              //    DR-8): forwarded verbatim to the report-driven child. ──
              session_list_loaded: { actions: "forwardToSessionChat" },
              session_list_failed: { actions: "forwardToSessionChat" },
              session_resumed: { actions: "forwardToSessionChat" },
              session_resume_failed: { actions: "forwardToSessionChat" },
              session_created: { actions: "forwardToSessionChat" },
              session_create_failed: { actions: "forwardToSessionChat" },
              dataset_context_switched: { actions: "forwardToSessionChat" },
              dataset_context_switch_failed: { actions: "forwardToSessionChat" },
            },
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
    },
  });
}
