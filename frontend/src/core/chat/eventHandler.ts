import { datasetKeys } from "../../lib/queryKeys";
import type { TableApi } from "./dispatcher";
import type { ChatEvent } from "./events";

export type EventHandlerContext = {
  queryClient: { invalidateQueries: (input: unknown) => unknown };
  table: TableApi;
  toast: { error: (msg: string) => void; success?: (msg: string) => void };
  thinking?: { setVisible: (v: boolean) => void };
};

export function handleChatEvent(event: ChatEvent, ctx: EventHandlerContext): void {
  switch (event.type) {
    case "transform_applied": {
      ctx.queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(event.dataset_id),
      });
      return;
    }
    case "error_occurred": {
      ctx.toast.error(event.message);
      return;
    }
    case "turn_done": {
      ctx.thinking?.setVisible(false);
      return;
    }
    default: {
      // PR 2-3 fill cases above this default as tools migrate. Until every
      // variant has a case, the cast keeps TS happy while the throw surfaces
      // untriaged events loudly. PR 3 removes the default and lets the
      // never-narrowing prove exhaustiveness at compile time (AC2.1).
      const _exhaustive: never = event as never;
      throw new Error(`unhandled chat event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
