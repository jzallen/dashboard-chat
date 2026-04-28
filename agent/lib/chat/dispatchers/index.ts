// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor.
// Registry that PR 1/2/3 dispatcher modules attach to. Empty until PR 0 wires
// the DispatchContext plumbing in handleChat.ts.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

export type DispatchContext = {
  jwt: string;
  datasetId?: string;
  projectId?: string;
  contextType: "dataset" | "project" | "report";
};

export type DispatcherFamily = "cleaning" | "mutations" | "ui";

export function dispatcherRegistry(_ctx: DispatchContext): never {
  throw new Error(NOT_IMPLEMENTED);
}
