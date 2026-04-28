import type { TableApi } from "./dispatcher";
import type { ChatEvent } from "./events";

export type EventHandlerContext = {
  queryClient: { invalidateQueries: (input: unknown) => unknown };
  table: TableApi;
  toast: { error: (msg: string) => void; success?: (msg: string) => void };
  thinking?: { setVisible: (v: boolean) => void };
};

export function handleChatEvent(event: ChatEvent, _ctx: EventHandlerContext): void {
  switch (event.type) {
    default: {
      // PR 1-3 fill cases above this default as tools migrate. The
      // `const _exhaustive: never = event` line is the AC2.1 marker — once
      // every variant has a case, TS narrows `event` to `never` and the cast
      // becomes redundant. Until then, we preserve the structural invariant
      // and throw so untriaged events surface loudly.
      const _exhaustive: never = event as never;
      throw new Error(`unhandled chat event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
