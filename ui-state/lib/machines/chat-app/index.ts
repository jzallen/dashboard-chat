// Barrel + COMPOSITION ROOT for the ChatApp coordinator machine directory.
//
// Public surface:
//   - createChatApp — the Phase-2 composition root (ADR-044 §4 Phase 2): it
//     constructs the THREE REAL child machines (session-onboarding,
//     project-context, session-chat) and swaps them over the placeholder DI slots
//     via `machine.provide({ actors })`. This is the one place that knows all
//     three children — the faithful "one root actor mediating parent-ignorant
//     children" of ADR-028. (It is NOT the live ui-state/index.ts app bootstrap;
//     wiring ChatApp into HTTP routing is Phase 4.)
//   - createChatAppMachine — the bare parent-coordinator statechart factory
//     (children left as inert placeholders). Phase-1 tests provide FAKES over it
//     (the fakes are inline in machine.test.ts); createChatApp provides the REAL
//     machines.
//   - ChatAppOnboardingLogic / ChatAppProjectContextLogic /
//     ChatAppSessionChatLogic — the three per-slot actor-logic types a caller
//     casts a provided child to (XState's `provide` is type-invariant in a
//     child's context, so the cast is unavoidable; pinning it per slot keeps
//     each provided machine attached to its own input contract).
//   - The wire/hand-off contract types a caller needs to drive or wire ChatApp.
//
// The internal context/guards/actions live under ./machine.ts + ./setup/ and are
// deliberately NOT re-exported.

import type { ProjectContextMachineDeps } from "../project-context/index.ts";
import { createProjectContextMachine } from "../project-context/index.ts";
import type { SessionChatMachineDeps } from "../session-chat/index.ts";
import { createSessionChatMachine } from "../session-chat/index.ts";
import { createSessionOnboardingMachine } from "../session-onboarding/index.ts";
import { createChatAppMachine } from "./machine.ts";
import type {
  ChatAppOnboardingLogic,
  ChatAppProjectContextLogic,
  ChatAppSessionChatLogic,
} from "./setup/actors.ts";

/**
 * The construction-time dependencies the composition root injects into the two
 * children that take their I/O ports as actors (project-context + session-chat).
 *
 * Asymmetry by design (it mirrors the children's own DI styles):
 *   - session-onboarding is config/input-driven — it needs NO construction deps;
 *     its WorkOS/backend URLs + fetch port arrive per-instance on
 *     SessionOnboardingInput (`config`/`deps`), threaded through the onboarding
 *     invoke `input:` mapper.
 *   - project-context + session-chat inject their resolver actors at construction
 *     (`createProjectContextMachine(deps)` / `createSessionChatMachine(deps)`).
 *     Production builds these from the env (`resolveInitialScopeActor(backendUrl,
 *     headers)`, `loadSessionListActor(...)`, …); tests pass `fromPromise` fakes.
 */
export interface ChatAppDeps {
  projectContext: ProjectContextMachineDeps;
  sessionChat: SessionChatMachineDeps;
}

/**
 * Phase-2 composition root: build a ChatApp machine wired to the REAL children.
 *
 * Constructs each real child machine and swaps it over the corresponding
 * placeholder slot via `machine.provide({ actors })`. Each cast to its per-slot
 * logic type is the localized, runtime-noop bridge the fakes use too —
 * XState's `provide` is type-invariant in a child's context, and the parent reads
 * child readiness through the `onSnapshot` snapshot views (setup/types.ts), never
 * through the slot type.
 *
 * Returns the wired machine; the caller does
 * `createActor(createChatApp(deps), { input })` — the parent's only cold-start
 * path bootstraps into onboarding, so `input` is `SessionOnboardingInput`.
 */
export function createChatApp(deps: ChatAppDeps) {
  const onboarding = createSessionOnboardingMachine();
  const projectContext = createProjectContextMachine(deps.projectContext);
  const sessionChat = createSessionChatMachine(deps.sessionChat);

  return createChatAppMachine().provide({
    actors: {
      onboarding: onboarding as unknown as ChatAppOnboardingLogic,
      projectContext: projectContext as unknown as ChatAppProjectContextLogic,
      sessionChat: sessionChat as unknown as ChatAppSessionChatLogic,
    },
  });
}

export { createChatAppMachine } from "./machine.ts";
export type {
  ChatAppOnboardingLogic,
  ChatAppProjectContextLogic,
  ChatAppSessionChatLogic,
} from "./setup/actors.ts";
export type {
  AuthHandoff,
  ChatAppChildEvent,
  ChatAppChildId,
  ChatAppContext,
  ChatAppEvent,
  ChatAppLifecycle,
  ChatUserIntent,
  ProjectContextInput,
  ProjectHandoff,
  SessionChatInput,
  SessionOnboardingInput,
} from "./setup/types.ts";
