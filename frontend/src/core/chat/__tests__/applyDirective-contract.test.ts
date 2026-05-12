/**
 * Contract test for ADR-015 / dc-x3y.2.2.
 *
 * Asserts that applying the FE's TanStack-bound `applyDirective`
 * (frontend/src/core/chat/dispatcher.ts) to a sequence of UI directives
 * produces the same `{sorting, columnFilters}` state as applying the
 * shared headless reducer
 * (`@dashboard-chat/shared-chat/applyDirective`) to the same sequence.
 *
 * If this test breaks, the persisted log emitted by
 * GET /api/channels/{id}/presentation-state has drifted from what the FE
 * actually applies — the log is no longer a faithful record of FE state.
 */

import {
  applyDirective as appliedReducer,
  initialPresentationState,
  type PresentationState,
  type UiDirective,
} from "@dashboard-chat/shared-chat";
import { describe, expect, it } from "vitest";

import { applyDirective as feApplyDirective, type TableApi } from "../dispatcher";

type ColumnSort = PresentationState["sorting"][number];
type RawColumnFilter = { id: string; value: unknown };

/**
 * TanStack-shaped capture: mirrors how a real TanStack table holds the
 * reactive state pieces the FE writes via setSorting/setColumnFilters/
 * resetColumnFilters. Used to translate the FE applyDirective's TableApi
 * side effects into a comparable `PresentationState`.
 */
function captureTableApi(): {
  api: TableApi;
  snapshot(): PresentationState;
} {
  let sorting: ColumnSort[] = [];
  let columnFilters: RawColumnFilter[] = [];
  const api: TableApi = {
    setSorting: (next) => {
      sorting = next;
    },
    setColumnFilters: (updater) => {
      columnFilters = typeof updater === "function" ? updater(columnFilters) : updater;
    },
    resetColumnFilters: () => {
      columnFilters = [];
    },
  };
  return {
    api,
    snapshot: () => ({
      sorting: sorting.map((s) => ({ ...s })),
      columnFilters: columnFilters.map((f) => ({
        id: f.id,
        value: f.value as PresentationState["columnFilters"][number]["value"],
      })),
    }),
  };
}

function uiDirectiveToFeDirective(d: UiDirective) {
  switch (d.type) {
    case "sort_directive":
      return { kind: "sort" as const, column: d.column, direction: d.direction };
    case "filter_directive":
      return { kind: "filter" as const, column: d.column, filters: d.filters };
    case "filters_cleared":
      return { kind: "clear_filters" as const };
  }
}

function applyAllToTable(directives: UiDirective[]): PresentationState {
  const { api, snapshot } = captureTableApi();
  for (const d of directives) {
    feApplyDirective(uiDirectiveToFeDirective(d), api);
  }
  return snapshot();
}

function applyAllToReducer(directives: UiDirective[]): PresentationState {
  return directives.reduce<PresentationState>(appliedReducer, initialPresentationState);
}

const SAMPLE_SCENARIOS: { name: string; directives: UiDirective[] }[] = [
  {
    name: "empty log",
    directives: [],
  },
  {
    name: "single sort",
    directives: [{ type: "sort_directive", column: "region", direction: "desc" }],
  },
  {
    name: "sort then re-sort same column",
    directives: [
      { type: "sort_directive", column: "region", direction: "asc" },
      { type: "sort_directive", column: "region", direction: "desc" },
    ],
  },
  {
    name: "sort A then sort B replaces sort",
    directives: [
      { type: "sort_directive", column: "a", direction: "asc" },
      { type: "sort_directive", column: "b", direction: "desc" },
    ],
  },
  {
    name: "filter on two columns preserves both",
    directives: [
      { type: "filter_directive", column: "amount", filters: [{ operator: "gt", value: 10 }] },
      { type: "filter_directive", column: "region", filters: [{ operator: "equals", value: "West" }] },
    ],
  },
  {
    name: "filter then re-filter same column upserts",
    directives: [
      { type: "filter_directive", column: "amount", filters: [{ operator: "gt", value: 10 }] },
      { type: "filter_directive", column: "amount", filters: [{ operator: "lt", value: 100 }] },
    ],
  },
  {
    name: "filters_cleared empties columnFilters but preserves sort",
    directives: [
      { type: "sort_directive", column: "region", direction: "asc" },
      { type: "filter_directive", column: "region", filters: [{ operator: "equals", value: "West" }] },
      { type: "filters_cleared" },
    ],
  },
  {
    name: "interleaved sort + filter",
    directives: [
      { type: "filter_directive", column: "a", filters: [{ operator: "equals", value: 1 }] },
      { type: "sort_directive", column: "b", direction: "asc" },
      { type: "filter_directive", column: "c", filters: [{ operator: "between", value: [0, 10] }] },
      { type: "filters_cleared" },
      { type: "sort_directive", column: "a", direction: "desc" },
    ],
  },
];

describe("Contract: FE applyDirective ≡ shared/chat reducer", () => {
  for (const scenario of SAMPLE_SCENARIOS) {
    it(`${scenario.name}: reducer output equals FE TableApi capture`, () => {
      const fromTable = applyAllToTable(scenario.directives);
      const fromReducer = applyAllToReducer(scenario.directives);

      // Order-sensitive comparison — the log is an ordered sequence and the
      // reducer must produce the same order TanStack stores filters in.
      expect(fromReducer).toEqual(fromTable);
    });
  }
});
