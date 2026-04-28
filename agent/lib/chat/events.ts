// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor.
// Real schema lands in PR 0 (DELIVER). When implemented, the polecat replaces
// this body with the discriminated-union Zod schema described in
// docs/feature/worker-tool-dispatch-refactor/design/design.md §3.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

export const ChatEventSchema = {
  parse(_input: unknown): never {
    throw new Error(NOT_IMPLEMENTED);
  },
  safeParse(_input: unknown): never {
    throw new Error(NOT_IMPLEMENTED);
  },
};

export type ChatEvent = never;
