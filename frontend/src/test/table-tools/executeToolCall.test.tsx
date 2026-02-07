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
} from "@/table-tools";

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
      setSorting: (updater) => {
        sorting = typeof updater === "function" ? updater(sorting) : updater;
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

    describe("Scenario: Multi-column sort", () => {
      it("should accumulate multiple sort columns", () => {
        const { table, handlers } = createTestTable(testData);

        // Sort by category first
        executeToolCall(
          createToolCall("sortTable", { column: "category", direction: "asc" }),
          handlers
        );

        // Then sort by amount (should add to existing sort)
        executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          handlers
        );

        // Expect: first by category asc (A, A, B), then by amount desc within each category
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
        ]);
      });

      it("should replace existing sort for same column", () => {
        const { table, handlers } = createTestTable(testData);

        // Sort by amount ascending
        executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "asc" }),
          handlers
        );

        // Sort by amount descending (should replace, not duplicate)
        executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          handlers
        );

        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
        ]);
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

    describe("Scenario: Delete a row by search", () => {
      it("should delete row matching search text and return message", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(createToolCall("deleteRow", { search: "Beta Widget" }), handlers);

        expect(message).toBe('Deleted row matching "Beta Widget"');
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
        ]);
      });

      it("should match case-insensitively", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(createToolCall("deleteRow", { search: "beta" }), handlers);

        expect(message).toBe('Deleted row matching "beta"');
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
        ]);
      });

      it("should not modify data if no match found", () => {
        const { table, handlers } = createTestTable(testData);

        const message = executeToolCall(createToolCall("deleteRow", { search: "Nonexistent" }), handlers);

        expect(message).toBe('Deleted row matching "Nonexistent"');
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual(testData);
      });
    });
  });

  describe("Feature: RAQB Filter Generation", () => {
    describe("Scenario: Apply single rule RAQB filter", () => {
      it("should apply RAQB filter and return message with condition count", () => {
        const { table, handlers } = createTestTable(testData);

        const raqbTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["A"],
              },
            },
          },
        };

        const message = executeToolCall(
          createToolCall("generateFilter", {
            description: "Show items in category A",
            raqb_tree: raqbTree,
          }),
          handlers
        );

        expect(message).toBe("Applied filter: Show items in category A (1 condition)");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "3", name: "Gamma", category: "A", amount: 25, quantity: 20, inStock: true },
        ]);
      });
    });

    describe("Scenario: Apply multi-rule RAQB filter with AND conjunction", () => {
      it("should apply all conditions with AND logic", () => {
        const { table, handlers } = createTestTable(testData);

        const raqbTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["A"],
              },
            },
            rule2: {
              type: "rule",
              properties: {
                field: "amount",
                operator: "greater",
                value: [30],
              },
            },
          },
        };

        const message = executeToolCall(
          createToolCall("generateFilter", {
            description: "Category A items over $30",
            raqb_tree: raqbTree,
          }),
          handlers
        );

        expect(message).toBe("Applied filter: Category A items over $30 (2 conditions)");
        // Only Alpha matches (category A AND amount > 30)
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
        ]);
      });
    });

    describe("Scenario: Apply RAQB filter with numeric comparison", () => {
      it("should apply greater_or_equal operator", () => {
        const { table, handlers } = createTestTable(testData);

        const raqbTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "amount",
                operator: "greater_or_equal",
                value: [50],
              },
            },
          },
        };

        const message = executeToolCall(
          createToolCall("generateFilter", {
            description: "Items with amount >= 50",
            raqb_tree: raqbTree,
          }),
          handlers
        );

        expect(message).toBe("Applied filter: Items with amount >= 50 (1 condition)");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
        ]);
      });
    });

    describe("Scenario: RAQB filter replaces existing filters", () => {
      it("should clear previous filters when applying RAQB filter", () => {
        const { table, handlers } = createTestTable(testData);

        // Apply initial filter
        executeToolCall(
          createToolCall("filterTable", { column: "inStock", operator: "equals", value: true }),
          handlers
        );
        expect(table.getFilteredRowModel().rows).toHaveLength(2);

        // Apply RAQB filter (should replace, not add to existing filters)
        const raqbTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["B"],
              },
            },
          },
        };

        executeToolCall(
          createToolCall("generateFilter", {
            description: "Category B only",
            raqb_tree: raqbTree,
          }),
          handlers
        );

        // Should show Beta Widget (category B) even though inStock is false
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
        ]);
      });
    });

    describe("Scenario: Apply RAQB filter with like operator", () => {
      it("should apply contains/like filter", () => {
        const { table, handlers } = createTestTable(testData);

        const raqbTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "name",
                operator: "like",
                value: ["a"],
              },
            },
          },
        };

        const message = executeToolCall(
          createToolCall("generateFilter", {
            description: "Names containing 'a'",
            raqb_tree: raqbTree,
          }),
          handlers
        );

        expect(message).toBe("Applied filter: Names containing 'a' (1 condition)");
        // Alpha, Beta Widget, Gamma all contain 'a'
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual([
          { id: "1", name: "Alpha", category: "A", amount: 50, quantity: 10, inStock: true },
          { id: "2", name: "Beta Widget", category: "B", amount: 100, quantity: 5, inStock: false },
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
