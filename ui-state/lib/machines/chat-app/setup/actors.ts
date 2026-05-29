// This file declares the TYPE SURFACE for ChatApp's children — what each child
// slot expects as input and accepts as events — so the parent statechart can be
// type-checked in isolation. The actual child instances are built and injected
// separately in `../index.ts` (the composition root), where the real
// `session-onboarding`, `project-context`, and `session-chat` machines are wired
// in over these placeholders.
//
// Splitting the concerns this way means the parent's invoke + sendTo type-check
// against a stable per-child contract here, independent of which concrete
// machine fills each slot.

import { setup } from "xstate";

import type {
  ChatAppChildEvent,
  ProjectContextInput,
  SessionChatInput,
  SessionOnboardingInput,
} from "./types.ts";

/** Build a do-nothing child whose input type is pinned by the caller. It
 *  accepts (and ignores) every event the parent may forward and never leaves
 *  `idle`; only ever exists to declare a slot's typing — `provide({ actors })`
 *  swaps the real machine over it. */
function createPlaceholderChild<TInput>() {
  return setup({
    types: {
      events: {} as ChatAppChildEvent,
      input: {} as TInput,
    },
  }).createMachine({
    id: "chat-app-child-placeholder",
    initial: "idle",
    states: { idle: {} },
  });
}

/** The three logical children threaded into `setup({ actors })`. Each key is a
 *  distinct placeholder so its `invoke.src` (and the corresponding
 *  `invoke.input` mapper in ../machine.ts) is typed against its OWN child-input
 *  contract — no cross-slot field leakage. */
export const actors = {
  onboarding: createPlaceholderChild<SessionOnboardingInput>(),
  projectContext: createPlaceholderChild<ProjectContextInput>(),
  sessionChat: createPlaceholderChild<SessionChatInput>(),
};

/** Cast target for a concrete onboarding machine provided over the `onboarding`
 *  placeholder slot. */
export type ChatAppOnboardingLogic = (typeof actors)["onboarding"];

/** Cast target for a concrete project-context machine provided over the
 *  `projectContext` placeholder slot. */
export type ChatAppProjectContextLogic = (typeof actors)["projectContext"];

/** Cast target for a concrete session-chat machine provided over the
 *  `sessionChat` placeholder slot. */
export type ChatAppSessionChatLogic = (typeof actors)["sessionChat"];

/**
 * The ProvidedActor union XState derives from `actors` when it types
 * `setup({ actors })`. XState's own `ToProvidedActor` is internal (not exported),
 * so we mirror its shape here — `{ src, logic, id }` per actor — DERIVED from
 * `typeof actors`, so adding/removing a child slot updates it automatically. The
 * extracted actions (./actions.ts) pin the `TActor` generic of both `assign` and
 * `enqueueActions` to this so the actions bundle is assignable to
 * `setup({ actions })`; without it the actions would carry the generic
 * `ProvidedActor` and the bundle would be rejected. (No children map →
 * `id: string | undefined`, matching XState.) Mirrors session-onboarding's
 * `ProvidedActorOf` / `SessionOnboardingActor`.
 */
type ProvidedActorOf<TActors extends Record<string, unknown>> = {
  [K in keyof TActors as K & string]: {
    src: K & string;
    logic: TActors[K];
    id: string | undefined;
  };
}[keyof TActors & string];

export type ChatAppActor = ProvidedActorOf<typeof actors>;
