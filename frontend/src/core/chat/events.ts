// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor.
// Per TWD-8 in distill/wave-decisions.md, the polecat at PR 0 chooses between
// (1) verbatim duplicate + sync test, (2) re-export from agent, (3) new shared
// workspace. Default: (1).

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
