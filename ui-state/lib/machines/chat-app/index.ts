// Barrel + COMPOSITION ROOT for the ChatApp coordinator machine directory.
//
// Public surface:
//   - createChatApp — the composition root: it constructs the THREE REAL child
//     machines (onboarding, project-context, session-chat) and swaps
//     them over the placeholder DI slots via `machine.provide({ actors })`. This
//     is the one place that knows all three children — the "one root actor
//     mediating parent-ignorant children".
//   - createChatAppMachine — the bare parent-coordinator statechart factory
//     (children left as inert placeholders). Tests provide FAKES over it (the
//     fakes are inline in machine.test.ts); createChatApp provides the REAL
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
//
// References:
//   docs/decisions/adr-044-*.md  — root orchestrator statechart
//   docs/decisions/adr-028-*.md  — one root actor mediating parent-ignorant children

import { createOnboardingMachine } from "../onboarding/index.ts";
import type { ProjectContextMachineDeps } from "../project-context/index.ts";
import { createProjectContextMachine } from "../project-context/index.ts";
import type { SessionChatMachineDeps } from "../session-chat/index.ts";
import { createSessionChatMachine } from "../session-chat/index.ts";
import { createSourceUploadMachine } from "../source-upload/index.ts";
import { createChatAppMachine } from "./machine.ts";
import type {
  ChatAppOnboardingLogic,
  ChatAppProjectContextLogic,
  ChatAppSessionChatLogic,
  ChatAppSourceUploadLogic,
} from "./setup/actors.ts";

/**
 * The construction-time dependencies the composition root injects into the two
 * children that take their I/O ports as actors (project-context + session-chat).
 *
 * Asymmetry by design (it mirrors the children's own DI styles):
 *   - onboarding is config/input-driven — it needs NO construction deps;
 *     its WorkOS/backend URLs + fetch port arrive per-instance on
 *     OnboardingInput (`config`/`deps`), threaded through the onboarding
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
 * Composition root: build a ChatApp machine wired to the REAL children.
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
 * path bootstraps into onboarding, so `input` is `OnboardingInput`.
 */
export function createChatApp(deps: ChatAppDeps) {
  const onboarding = createOnboardingMachine();
  const projectContext = createProjectContextMachine(deps.projectContext);
  const sessionChat = createSessionChatMachine(deps.sessionChat);
  const sourceUpload = createSourceUploadMachine();

  return createChatAppMachine().provide({
    actors: {
      onboarding: onboarding as unknown as ChatAppOnboardingLogic,
      projectContext: projectContext as unknown as ChatAppProjectContextLogic,
      sessionChat: sessionChat as unknown as ChatAppSessionChatLogic,
      sourceUpload: sourceUpload as unknown as ChatAppSourceUploadLogic,
    },
  });
}

export { createChatAppMachine } from "./machine.ts";
export type {
  ChatAppOnboardingLogic,
  ChatAppProjectContextLogic,
  ChatAppSessionChatLogic,
  ChatAppSourceUploadLogic,
} from "./setup/actors.ts";
export type {
  AuthHandoff,
  ChatAppChildEvent,
  ChatAppChildId,
  ChatAppContext,
  ChatAppEvent,
  ChatAppLifecycle,
  ChatUserIntent,
  OnboardingInput,
  ProjectContextInput,
  ProjectHandoff,
  SessionChatInput,
  SourceUploadInput,
} from "./setup/types.ts";
