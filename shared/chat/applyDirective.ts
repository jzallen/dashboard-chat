/**
 * Headless reference reducer for ADR-015's reflect-only directive log.
 *
 * Mirrors the FE's TanStack-bound `applyDirective` (reverse-proxy/src/core/chat/dispatcher.ts)
 * by producing the same sort/columnFilters values the FE writes into TanStack
 * via `setSorting`/`setColumnFilters`/`resetColumnFilters`. Headless consumers
 * (Phase 1 Epic D Python harness, future SDKs, replay tooling) reduce a
 * `UiDirective[]` log into a settled state object without driving a browser.
 *
 * Shape mirrors TanStack's accepted values verbatim:
 *   - `sorting`        → `{ id: column, desc: direction === "desc" }[]`
 *   - `columnFilters`  → `{ id: column, value: Filter[] }[]`
 *
 * Semantics mirror what the FE feeds TanStack:
 *   - `sort_directive`    replaces `sorting` with a single-column descriptor.
 *   - `filter_directive`  upserts the column's filter array, preserving others.
 *   - `filters_cleared`   empties `columnFilters`.
 */

import type { Filter, UiDirective } from "./events";

export type ColumnSort = { id: string; desc: boolean };
export type ColumnFilterEntry = { id: string; value: Filter[] };

export type PresentationState = {
  sorting: ColumnSort[];
  columnFilters: ColumnFilterEntry[];
};

export const initialPresentationState: PresentationState = {
  sorting: [],
  columnFilters: [],
};

function upsertColumnFilter(
  prev: ColumnFilterEntry[],
  column: string,
  filters: Filter[],
): ColumnFilterEntry[] {
  const without = prev.filter((f) => f.id !== column);
  return [...without, { id: column, value: filters }];
}

export function applyDirective(
  state: PresentationState,
  directive: UiDirective,
): PresentationState {
  switch (directive.type) {
    case "sort_directive":
      return {
        ...state,
        sorting: [
          { id: directive.column, desc: directive.direction === "desc" },
        ],
      };
    case "filter_directive":
      return {
        ...state,
        columnFilters: upsertColumnFilter(
          state.columnFilters,
          directive.column,
          directive.filters,
        ),
      };
    case "filters_cleared":
      return { ...state, columnFilters: [] };
  }
}

export function reducePresentationState(
  directives: ReadonlyArray<UiDirective>,
  initial: PresentationState = initialPresentationState,
): PresentationState {
  return directives.reduce<PresentationState>(applyDirective, initial);
}
