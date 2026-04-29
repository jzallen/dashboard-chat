import { datasetKeys } from "../../lib/queryKeys";
import { applyDirective, type TableApi } from "./dispatcher";
import type { ChatEvent } from "./events";

export type EventHandlerContext = {
  queryClient: { invalidateQueries: (input: unknown) => unknown };
  table: TableApi;
  toast: { error: (msg: string) => void; success?: (msg: string) => void };
  thinking?: { setVisible: (v: boolean) => void };
};

export function handleChatEvent(event: ChatEvent, ctx: EventHandlerContext): void {
  switch (event.type) {
    case "assistant_text_delta": {
      // Chat panel renders text deltas elsewhere (via subscription); nothing
      // for the structural handler to do here.
      return;
    }
    case "transform_applied":
    case "row_added":
    case "row_deleted":
    case "column_renamed":
    case "transform_undone":
    case "transform_re_enabled": {
      // Mechanical FE reaction: refetch the dataset; backend re-renders the
      // view (including disable-vs-delete differences for transform_undone).
      ctx.queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(event.dataset_id),
      });
      return;
    }
    case "sort_directive": {
      applyDirective(
        { kind: "sort", column: event.column, direction: event.direction },
        ctx.table,
      );
      return;
    }
    case "filter_directive": {
      applyDirective(
        { kind: "filter", column: event.column, filters: event.filters },
        ctx.table,
      );
      return;
    }
    case "filters_cleared": {
      applyDirective({ kind: "clear_filters" }, ctx.table);
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
      // Compile-time exhaustiveness (AC2.1): if a new ChatEvent variant lands
      // without a matching case above, this assignment fails to type-check.
      // The throw is defensive — every variant has a case in normal flow.
      const _exhaustive: never = event;
      throw new Error(`unhandled chat event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
