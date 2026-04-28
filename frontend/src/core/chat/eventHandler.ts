// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor PR 0.
// handleChatEvent is the FE switch on event.type. PR 0 ships the skeleton with
// no cases handled (every call throws). PRs 1-3 add cases as tools migrate.
// The `default: const _: never = event` line gives AC2.1 its compile-time
// exhaustiveness — preserve it during DELIVER.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

import type { ChatEvent } from "./events";
import type { TableApi } from "./dispatcher";

export type EventHandlerContext = {
  queryClient: { invalidateQueries: (input: unknown) => unknown };
  table: TableApi;
  toast: { error: (msg: string) => void; success?: (msg: string) => void };
  thinking?: { setVisible: (v: boolean) => void };
};

export function handleChatEvent(_event: ChatEvent, _ctx: EventHandlerContext): void {
  throw new Error(NOT_IMPLEMENTED);
}
