import { describe, it, expect } from "vitest";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/table-core";
import {
  executeToolCall,
  customFilterFn,
  type ToolCall,
  type ToolCallHandlers,
  type TableRow,
} from "../lib/executeToolCall";

/**
 * Tests for executeToolCall - the public API used by App.tsx.
 *
 * These tests verify both the table state changes and the returned message.
 * We use `.rows.map((r) => r.original)` when asserting on table results to extract
 * the raw TableRow data. TanStack's Row objects contain internal properties (id, index,
 * depth, getValue, etc.) that we don't want to couple our tests to. By mapping to
 * `.original`, we assert only on the business data in the order it appears.
 *
 * @see https://tanstack.com/table/v8/docs/guide/rows#access-original-row-data
 */
describe("executeToolCall", () => {
  const testData: TableRow[] = [
    { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
    { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
    { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
  ];

  const columns: ColumnDef<TableRow>[] = [
    { accessorKey: "id", header: "ID" },
    { accessorKey: "name", header: "Name" },
    { accessorKey: "category", header: "Category" },
    { accessorKey: "amount", header: "Amount" },
    { accessorKey: "quantity", header: "Quantity" },
    { accessorKey: "inStock", header: "In Stock" },
  ];

  const createToolCall = (
    name: string,
    args: Record<string, unknown>
  ): ToolCall => ({
    id: "test-id",
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });

  const createTestTable = (initialData: TableRow[]) => {
    let data = [...initialData];
    let sorting: SortingState = [];
    let columnFilters: ColumnFiltersState = [];

    const table = createTable({
      data,
      columns,
      state: { sorting, columnFilters },
      onSortingChange: (updater) => {
        sorting = typeof updater === "function" ? updater(sorting) : updater;
      },
      onColumnFiltersChange: (updater) => {
        columnFilters = typeof updater === "function" ? updater(columnFilters) : updater;
      },
      onStateChange: () => {},
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      filterFns: { custom: customFilterFn },
      defaultColumn: { filterFn: customFilterFn },
      renderFallbackValue: null,
    });

    const handlers: ToolCallHandlers = {
      setColumnFilters: (updater) => {
        columnFilters = typeof updater === "function" ? updater(columnFilters) : updater;
        table.setOptions((prev) => ({ ...prev, state: { ...prev.state, columnFilters } }));
      },
      setSorting: (newSorting) => {
        sorting = newSorting;
        table.setOptions((prev) => ({ ...prev, state: { ...prev.state, sorting } }));
      },
      setData: (updater) => {
        data = updater(data);
        table.setOptions((prev) => ({ ...prev, data }));
      },
    };

    return { table, handlers };
  };

  describe("Feature: Table Filtering", () => {
    describe("Scenario: Filter table by column", () => {
      it("should filter rows and return message", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(
          createToolCall("filterTable", { column: "name", operator: "contains", value: "Widget" }),
          handlers
        );

        expect(message).toBe("Filtered name contains Widget");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
        ]);
      });
    });

    describe("Scenario: Filter by numeric comparison", () => {
      it("should filter rows where amount is greater than 30", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(
          createToolCall("filterTable", { column: "amount", operator: "gt", value: 30 }),
          handlers
        );

        expect(message).toBe("Filtered amount gt 30");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
        ]);
      });
    });

    describe("Scenario: Clear active filters", () => {
      it("should clear filters and return message", () => {
        const { table, handlers } = createTestTable(testData);

        // Apply filter first
        executeToolCall(
          createToolCall("filterTable", { column: "name", operator: "contains", value: "Widget" }),
          handlers
        );
        expect(table.getFilteredRowModel().rows).toHaveLength(1);

        // Clear filters
        const message = executeToolCall(createToolCall("clearFilters", {}), handlers);

        expect(message).toBe("Cleared all filters");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(testData);
      });
    });
  });

  describe("Feature: Table Sorting", () => {
    describe("Scenario: Sort by column ascending", () => {
      it("should sort rows and return message", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "asc" }),
          handlers
        );

        expect(message).toBe("Sorted by amount asc");
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
        ]);
      });
    });

    describe("Scenario: Sort by column descending", () => {
      it("should sort rows descending and return message", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          handlers
        );

        expect(message).toBe("Sorted by amount desc");
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
        ]);
      });
    });

    describe("Scenario: Clear sorting", () => {
      it("should clear sort and return message", () => {
        const { table, handlers } = createTestTable(testData);

        // Apply sort first
        executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          handlers
        );

        // Clear sort
        const message = executeToolCall(createToolCall("clearSort", {}), handlers);

        expect(message).toBe("Cleared sorting");
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual(testData);
      });
    });
  });

  describe("Feature: Table Row Management", () => {
    describe("Scenario: Add a new row", () => {
      it("should add row and return message", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(
          createToolCall("addRow", {
            data: { id: "4", name: "New Item", category: "C", amount: 75, quantity: 15, inStock: true },
          }),
          handlers
        );

        expect(message).toBe("Added new row");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
          { id: "4", name: "New Item", category: "C", amount: 75, quantity: 15, inStock: true },
        ]);
      });
    });

    describe("Scenario: Delete a row by index", () => {
      it("should delete row and return message", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(createToolCall("deleteRow", { rowIndex: 1 }), handlers);

        expect(message).toBe("Deleted row at index 1");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
        ]);
      });
    });
  });

  describe("Feature: Error Handling", () => {
    describe("Scenario: Invalid JSON arguments", () => {
      it("should return error message and not modify table", () => {
        const { table, handlers } = createTestTable(testData);
        const toolCall: ToolCall = {
          id: "test-id",
          type: "function",
          function: { name: "filterTable", arguments: "{ invalid json }" },
        };

        const message = executeToolCall(toolCall, handlers);

        expect(message).toBe("Error: Invalid arguments for filterTable");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual(testData);
      });
    });

    describe("Scenario: Unknown tool name", () => {
      it("should return unknown tool message and not modify table", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(createToolCall("unknownTool", { foo: "bar" }), handlers);

        expect(message).toBe("Unknown tool: unknownTool");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual(testData);
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(testData);
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual(testData);
      });
    });
  });
});
