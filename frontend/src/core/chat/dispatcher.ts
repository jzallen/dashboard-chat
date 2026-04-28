// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor PR 0.
// applyDirective is the shared body called by both the SSE event handler and
// direct UI click handlers (DESIGN §2.1). Real impl wires TanStack Table API.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

export type Filter = { op: string; values: unknown[] };

export type Directive =
  | { kind: "sort"; column: string; direction: "asc" | "desc" }
  | { kind: "filter"; column: string; filters: Filter[] }
  | { kind: "clear_filters" };

export type TableApi = {
  setSorting: (s: unknown) => void;
  setColumnFilters: (updater: unknown) => void;
  resetColumnFilters: () => void;
};

export function applyDirective(_directive: Directive, _table: TableApi): void {
  throw new Error(NOT_IMPLEMENTED);
}
