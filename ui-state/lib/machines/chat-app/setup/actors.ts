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
  OnboardingChildInput,
  ProjectContextChildInput,
  SessionChatChildInput,
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
  onboarding: createPlaceholderChild<OnboardingChildInput>(),
  projectContext: createPlaceholderChild<ProjectContextChildInput>(),
  sessionChat: createPlaceholderChild<SessionChatChildInput>(),
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
