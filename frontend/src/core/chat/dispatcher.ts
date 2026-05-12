import type { Filter } from "./events";

export type { Filter } from "./events";

export type Directive =
  | { kind: "sort"; column: string; direction: "asc" | "desc" }
  | { kind: "filter"; column: string; filters: Filter[] }
  | { kind: "clear_filters" };

type ColumnFilter = { id: string; value: unknown };

export type TableApi = {
  setSorting: (updater: { id: string; desc: boolean }[]) => void;
  setColumnFilters: (
    updater: ColumnFilter[] | ((prev: ColumnFilter[]) => ColumnFilter[]),
  ) => void;
  resetColumnFilters: () => void;
};

function upsertFilter(prev: ColumnFilter[], column: string, filters: Filter[]): ColumnFilter[] {
  const without = prev.filter((f) => f.id !== column);
  return [...without, { id: column, value: filters }];
}

export function applyDirective(directive: Directive, table: TableApi): void {
  switch (directive.kind) {
    case "sort":
      table.setSorting([{ id: directive.column, desc: directive.direction === "desc" }]);
      return;
    case "filter":
      table.setColumnFilters((prev) => upsertFilter(prev, directive.column, directive.filters));
      return;
    case "clear_filters":
      table.resetColumnFilters();
      return;
  }
}
