import { QueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  type ColumnFiltersState,
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
} from "@tanstack/react-table";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  customFilterFn,
  executeToolCall,
  type TableRow,
  type ToolCall,
  type ToolCallContext,
} from "@/toolCalls";

// Mock useDatasetQuery keys (used for cache invalidation)
vi.mock("../../../ui/hooks/useDatasetQuery", () => ({
  datasetKeys: {
    detail: (id: string) => ["datasets", id],
  },
}));

const mockPreviewCleaningTransform = vi.fn();
const mockCreateCleaningTransforms = vi.fn();
const mockUpdateTransform = vi.fn();

const mockCatalog = {
  previewCleaningTransform: mockPreviewCleaningTransform,
  createCleaningTransforms: mockCreateCleaningTransforms,
  updateTransform: mockUpdateTransform,
};

/**
 * Tests for executeToolCall - the public API used by DatasetView.
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
    {
      id: "1",
      name: "Alpha",
      category: "A",
      amount: 50,
      quantity: 10,
      inStock: true,
    },
    {
      id: "2",
      name: "Beta Widget",
      category: "B",
      amount: 100,
      quantity: 5,
      inStock: false,
    },
    {
      id: "3",
      name: "Gamma",
      category: "A",
      amount: 25,
      quantity: 20,
      inStock: true,
    },
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
    args: Record<string, unknown>,
  ): ToolCall => ({
    id: "test-id",
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });

  const createTestTable = () => {
    let data = [...testData];
    let sorting: SortingState = [];
    let columnFilters: ColumnFiltersState = [];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const table = createTable({
      data,
      columns,
      state: { sorting, columnFilters },
      onSortingChange: (updater) => {
        sorting = typeof updater === "function" ? updater(sorting) : updater;
      },
      onColumnFiltersChange: (updater) => {
        columnFilters =
          typeof updater === "function" ? updater(columnFilters) : updater;
      },
      onStateChange: () => {},
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      filterFns: { custom: customFilterFn },
      defaultColumn: { filterFn: customFilterFn },
      renderFallbackValue: null,
    });

    const context: ToolCallContext = {
      setColumnFilters: (updater) => {
        columnFilters =
          typeof updater === "function" ? updater(columnFilters) : updater;
        table.setOptions((prev) => ({
          ...prev,
          state: { ...prev.state, columnFilters },
        }));
      },
      setSorting: (updater) => {
        sorting = typeof updater === "function" ? updater(sorting) : updater;
        table.setOptions((prev) => ({
          ...prev,
          state: { ...prev.state, sorting },
        }));
      },
      setData: (updater) => {
        data = updater(data);
        table.setOptions((prev) => ({ ...prev, data }));
      },
      datasetId: "ds-test-001",
      transforms: [],
      queryClient,
      catalog: mockCatalog as any,
    };

    return { table, context, queryClient };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Feature: Table Filtering", () => {
    describe("Scenario: Filter table by column", () => {
      it("should filter rows and return message", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("filterTable", {
            column: "name",
            operator: "contains",
            value: "Widget",
          }),
          context,
        );

        expect(message).toBe("Filtered name contains Widget");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "2",
              name: "Beta Widget",
              category: "B",
              amount: 100,
              quantity: 5,
              inStock: false,
            },
          ],
        );
      });
    });

    describe("Scenario: Filter by numeric comparison", () => {
      it("should filter rows where amount is greater than 30", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("filterTable", {
            column: "amount",
            operator: "gt",
            value: 30,
          }),
          context,
        );

        expect(message).toBe("Filtered amount gt 30");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "1",
              name: "Alpha",
              category: "A",
              amount: 50,
              quantity: 10,
              inStock: true,
            },
            {
              id: "2",
              name: "Beta Widget",
              category: "B",
              amount: 100,
              quantity: 5,
              inStock: false,
            },
          ],
        );
      });
    });

    describe("Scenario: Clear active filters", () => {
      it("should clear filters and return message", async () => {
        const { table, context } = createTestTable();

        // Apply filter first
        await executeToolCall(
          createToolCall("filterTable", {
            column: "name",
            operator: "contains",
            value: "Widget",
          }),
          context,
        );
        expect(table.getFilteredRowModel().rows).toHaveLength(1);

        // Clear filters
        const message = await executeToolCall(
          createToolCall("clearFilters", {}),
          context,
        );

        expect(message).toBe("Cleared all filters");
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
      });
    });
  });

  describe("Feature: Table Sorting", () => {
    describe("Scenario: Sort by column ascending", () => {
      it("should sort rows and return message", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "asc" }),
          context,
        );

        expect(message).toBe("Sorted by amount asc");
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "2",
            name: "Beta Widget",
            category: "B",
            amount: 100,
            quantity: 5,
            inStock: false,
          },
        ]);
      });
    });

    describe("Scenario: Sort by column descending", () => {
      it("should sort rows descending and return message", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          context,
        );

        expect(message).toBe("Sorted by amount desc");
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "2",
            name: "Beta Widget",
            category: "B",
            amount: 100,
            quantity: 5,
            inStock: false,
          },
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
        ]);
      });
    });

    describe("Scenario: Clear sorting", () => {
      it("should clear sort and return message", async () => {
        const { table, context } = createTestTable();

        // Apply sort first
        await executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          context,
        );

        // Clear sort
        const message = await executeToolCall(
          createToolCall("clearSort", {}),
          context,
        );

        expect(message).toBe("Cleared sorting");
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
      });
    });

    describe("Scenario: Multi-column sort", () => {
      it("should accumulate multiple sort columns", async () => {
        const { table, context } = createTestTable();

        // Sort by category first
        await executeToolCall(
          createToolCall("sortTable", { column: "category", direction: "asc" }),
          context,
        );

        // Then sort by amount (should add to existing sort)
        await executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          context,
        );

        // Expect: first by category asc (A, A, B), then by amount desc within each category
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
          {
            id: "2",
            name: "Beta Widget",
            category: "B",
            amount: 100,
            quantity: 5,
            inStock: false,
          },
        ]);
      });

      it("should replace existing sort for same column", async () => {
        const { table, context } = createTestTable();

        // Sort by amount ascending
        await executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "asc" }),
          context,
        );

        // Sort by amount descending (should replace, not duplicate)
        await executeToolCall(
          createToolCall("sortTable", { column: "amount", direction: "desc" }),
          context,
        );

        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "2",
            name: "Beta Widget",
            category: "B",
            amount: 100,
            quantity: 5,
            inStock: false,
          },
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
        ]);
      });
    });
  });

  describe("Feature: Table Row Management", () => {
    describe("Scenario: Add a new row", () => {
      it("should add row and return message", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("addRow", {
            data: {
              id: "4",
              name: "New Item",
              category: "C",
              amount: 75,
              quantity: 15,
              inStock: true,
            },
          }),
          context,
        );

        expect(message).toBe("Added new row");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "2",
            name: "Beta Widget",
            category: "B",
            amount: 100,
            quantity: 5,
            inStock: false,
          },
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
          {
            id: "4",
            name: "New Item",
            category: "C",
            amount: 75,
            quantity: 15,
            inStock: true,
          },
        ]);
      });
    });

    describe("Scenario: Delete a row by search", () => {
      it("should delete row matching search text and return message", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("deleteRow", { search: "Beta Widget" }),
          context,
        );

        expect(message).toBe('Deleted row matching "Beta Widget"');
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
        ]);
      });

      it("should match case-insensitively", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("deleteRow", { search: "beta" }),
          context,
        );

        expect(message).toBe('Deleted row matching "beta"');
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual([
          {
            id: "1",
            name: "Alpha",
            category: "A",
            amount: 50,
            quantity: 10,
            inStock: true,
          },
          {
            id: "3",
            name: "Gamma",
            category: "A",
            amount: 25,
            quantity: 20,
            inStock: true,
          },
        ]);
      });

      it("should not modify data if no match found", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("deleteRow", { search: "Nonexistent" }),
          context,
        );

        expect(message).toBe('Deleted row matching "Nonexistent"');
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
      });
    });
  });

  describe("Feature: RAQB Filter Generation", () => {
    describe("Scenario: Apply single rule RAQB filter", () => {
      it("should apply RAQB filter and return message with condition count", async () => {
        const { table, context } = createTestTable();

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

        const message = await executeToolCall(
          createToolCall("generateFilter", {
            description: "Show items in category A",
            raqb_tree: raqbTree,
          }),
          context,
        );

        expect(message).toBe(
          "Applied filter: Show items in category A (1 condition)",
        );
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "1",
              name: "Alpha",
              category: "A",
              amount: 50,
              quantity: 10,
              inStock: true,
            },
            {
              id: "3",
              name: "Gamma",
              category: "A",
              amount: 25,
              quantity: 20,
              inStock: true,
            },
          ],
        );
      });
    });

    describe("Scenario: Apply multi-rule RAQB filter with AND conjunction", () => {
      it("should apply all conditions with AND logic", async () => {
        const { table, context } = createTestTable();

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

        const message = await executeToolCall(
          createToolCall("generateFilter", {
            description: "Category A items over $30",
            raqb_tree: raqbTree,
          }),
          context,
        );

        expect(message).toBe(
          "Applied filter: Category A items over $30 (2 conditions)",
        );
        // Only Alpha matches (category A AND amount > 30)
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "1",
              name: "Alpha",
              category: "A",
              amount: 50,
              quantity: 10,
              inStock: true,
            },
          ],
        );
      });
    });

    describe("Scenario: Apply RAQB filter with numeric comparison", () => {
      it("should apply greater_or_equal operator", async () => {
        const { table, context } = createTestTable();

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

        const message = await executeToolCall(
          createToolCall("generateFilter", {
            description: "Items with amount >= 50",
            raqb_tree: raqbTree,
          }),
          context,
        );

        expect(message).toBe(
          "Applied filter: Items with amount >= 50 (1 condition)",
        );
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "1",
              name: "Alpha",
              category: "A",
              amount: 50,
              quantity: 10,
              inStock: true,
            },
            {
              id: "2",
              name: "Beta Widget",
              category: "B",
              amount: 100,
              quantity: 5,
              inStock: false,
            },
          ],
        );
      });
    });

    describe("Scenario: RAQB filter replaces existing filters", () => {
      it("should clear previous filters when applying RAQB filter", async () => {
        const { table, context } = createTestTable();

        // Apply initial filter
        await executeToolCall(
          createToolCall("filterTable", {
            column: "inStock",
            operator: "equals",
            value: true,
          }),
          context,
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

        await executeToolCall(
          createToolCall("generateFilter", {
            description: "Category B only",
            raqb_tree: raqbTree,
          }),
          context,
        );

        // Should show Beta Widget (category B) even though inStock is false
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "2",
              name: "Beta Widget",
              category: "B",
              amount: 100,
              quantity: 5,
              inStock: false,
            },
          ],
        );
      });
    });

    describe("Scenario: Apply RAQB filter with like operator", () => {
      it("should apply contains/like filter", async () => {
        const { table, context } = createTestTable();

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

        const message = await executeToolCall(
          createToolCall("generateFilter", {
            description: "Names containing 'a'",
            raqb_tree: raqbTree,
          }),
          context,
        );

        expect(message).toBe(
          "Applied filter: Names containing 'a' (1 condition)",
        );
        // Alpha, Beta Widget, Gamma all contain 'a'
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          [
            {
              id: "1",
              name: "Alpha",
              category: "A",
              amount: 50,
              quantity: 10,
              inStock: true,
            },
            {
              id: "2",
              name: "Beta Widget",
              category: "B",
              amount: 100,
              quantity: 5,
              inStock: false,
            },
            {
              id: "3",
              name: "Gamma",
              category: "A",
              amount: 25,
              quantity: 20,
              inStock: true,
            },
          ],
        );
      });
    });
  });

  describe("Feature: Error Handling", () => {
    describe("Scenario: Invalid JSON arguments", () => {
      it("should return error message and not modify table", async () => {
        const { table, context } = createTestTable();
        const toolCall: ToolCall = {
          id: "test-id",
          type: "function",
          function: { name: "filterTable", arguments: "{ invalid json }" },
        };

        const message = await executeToolCall(toolCall, context);

        expect(message).toBe("Error: Invalid arguments for filterTable");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
      });
    });

    describe("Scenario: Unknown tool name", () => {
      it("should return unknown tool message and not modify table", async () => {
        const { table, context } = createTestTable();

        const message = await executeToolCall(
          createToolCall("unknownTool", { foo: "bar" }),
          context,
        );

        expect(message).toBe("Error: Unknown tool: unknownTool");
        expect(table.getCoreRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
        expect(table.getFilteredRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
        expect(table.getSortedRowModel().rows.map((r) => r.original)).toEqual(
          testData,
        );
      });
    });
  });

  describe("Feature: Cleaning Tool Handlers", () => {
    const mockPreviewResponse = {
      affected_count: 3,
      total_count: 10,
      samples: [
        { before: "  hello  ", after: "hello" },
        { before: "  world  ", after: "world" },
      ],
      column: "name",
      operation_description: "Trim whitespace from name",
    };

    describe("Scenario: Trim whitespace preview", () => {
      it("should call preview API and return formatted result", async () => {
        const { context } = createTestTable();
        mockPreviewCleaningTransform.mockResolvedValue(mockPreviewResponse);

        const message = await executeToolCall(
          createToolCall("trimWhitespace", { column: "name" }),
          context,
        );

        expect(mockPreviewCleaningTransform).toHaveBeenCalledWith(
          "ds-test-001",
          {
            transform_type: "clean",
            target_column: "name",
            expression_config: { operation: "trim" },
          },
        );
        expect(message).toContain("Preview: Trim whitespace from name");
        expect(message).toContain("Affected: 3 of 10 rows");
        expect(message).toContain('"  hello  " → "hello"');
      });
    });

    describe("Scenario: Standardize case preview", () => {
      it("should call preview API with mode and return formatted result", async () => {
        const { context } = createTestTable();
        mockPreviewCleaningTransform.mockResolvedValue({
          ...mockPreviewResponse,
          operation_description: "Uppercase name",
          samples: [{ before: "hello", after: "HELLO" }],
        });

        const message = await executeToolCall(
          createToolCall("standardizeCase", { column: "name", mode: "upper" }),
          context,
        );

        expect(mockPreviewCleaningTransform).toHaveBeenCalledWith(
          "ds-test-001",
          {
            transform_type: "clean",
            target_column: "name",
            expression_config: { operation: "case", mode: "upper" },
          },
        );
        expect(message).toContain("Preview: Uppercase name");
        expect(message).toContain('"hello" → "HELLO"');
      });
    });

    describe("Scenario: Fill nulls preview", () => {
      it("should call preview API with fill_value and return formatted result", async () => {
        const { context } = createTestTable();
        mockPreviewCleaningTransform.mockResolvedValue({
          ...mockPreviewResponse,
          operation_description: "Fill null values in name with N/A",
          samples: [{ before: null, after: "N/A" }],
        });

        const message = await executeToolCall(
          createToolCall("fillNulls", { column: "name", fillValue: "N/A" }),
          context,
        );

        expect(mockPreviewCleaningTransform).toHaveBeenCalledWith(
          "ds-test-001",
          {
            transform_type: "clean",
            target_column: "name",
            expression_config: { operation: "fill_null", fill_value: "N/A" },
          },
        );
        expect(message).toContain("Fill null values in name with N/A");
        expect(message).toContain('null → "N/A"');
      });
    });

    describe("Scenario: Map values preview", () => {
      it("should call preview API with mappings and return formatted result", async () => {
        const { context } = createTestTable();
        mockPreviewCleaningTransform.mockResolvedValue({
          ...mockPreviewResponse,
          operation_description: "Map values in category",
          samples: [{ before: "A", after: "Category A" }],
        });

        const mappings = [
          { from: "A", to: "Category A" },
          { from: "B", to: "Category B" },
        ];
        const message = await executeToolCall(
          createToolCall("mapValues", { column: "category", mappings }),
          context,
        );

        expect(mockPreviewCleaningTransform).toHaveBeenCalledWith(
          "ds-test-001",
          {
            transform_type: "map",
            target_column: "category",
            expression_config: { operation: "map_values", mappings },
          },
        );
        expect(message).toContain("Map values in category");
        expect(message).toContain('"A" → "Category A"');
      });
    });

    describe("Scenario: Rename column", () => {
      it("should create alias transform and invalidate cache", async () => {
        const { context, queryClient } = createTestTable();
        mockCreateCleaningTransforms.mockResolvedValue(undefined);
        const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

        const message = await executeToolCall(
          createToolCall("renameColumn", {
            column: "name",
            newName: "Product Name",
          }),
          context,
        );

        expect(mockCreateCleaningTransforms).toHaveBeenCalledWith(
          "ds-test-001",
          [
            {
              name: "Rename name to Product Name",
              transform_type: "alias",
              target_column: "name",
              expression_config: { operation: "alias", alias: "Product Name" },
            },
          ],
        );
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ["datasets", "ds-test-001"],
          exact: true,
        });
        expect(message).toBe("Renamed column: name → Product Name");
      });
    });

    describe("Scenario: Apply cleaning transform", () => {
      it("should create trim transform and invalidate cache", async () => {
        const { context, queryClient } = createTestTable();
        mockCreateCleaningTransforms.mockResolvedValue(undefined);
        const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

        const message = await executeToolCall(
          createToolCall("applyCleaningTransform", {
            column: "name",
            operation: "trim",
            config: {},
          }),
          context,
        );

        expect(mockCreateCleaningTransforms).toHaveBeenCalledWith(
          "ds-test-001",
          [
            {
              name: "trim on name",
              transform_type: "clean",
              target_column: "name",
              expression_config: { operation: "trim" },
            },
          ],
        );
        expect(invalidateSpy).toHaveBeenCalled();
        expect(message).toBe("Applied: trim on name");
      });

      it("should map case operations to correct expression_config", async () => {
        const { context } = createTestTable();
        mockCreateCleaningTransforms.mockResolvedValue(undefined);

        await executeToolCall(
          createToolCall("applyCleaningTransform", {
            column: "name",
            operation: "upper",
            config: {},
          }),
          context,
        );

        expect(mockCreateCleaningTransforms).toHaveBeenCalledWith(
          "ds-test-001",
          [
            {
              name: "upper on name",
              transform_type: "clean",
              target_column: "name",
              expression_config: { operation: "case", mode: "upper" },
            },
          ],
        );
      });

      it("should map snake case operation to correct expression_config", async () => {
        const { context } = createTestTable();
        mockCreateCleaningTransforms.mockResolvedValue(undefined);

        await executeToolCall(
          createToolCall("applyCleaningTransform", {
            column: "name",
            operation: "snake",
            config: {},
          }),
          context,
        );

        expect(mockCreateCleaningTransforms).toHaveBeenCalledWith(
          "ds-test-001",
          [
            {
              name: "snake on name",
              transform_type: "clean",
              target_column: "name",
              expression_config: { operation: "case", mode: "snake" },
            },
          ],
        );
      });

      it("should map kebab case operation to correct expression_config", async () => {
        const { context } = createTestTable();
        mockCreateCleaningTransforms.mockResolvedValue(undefined);

        await executeToolCall(
          createToolCall("applyCleaningTransform", {
            column: "name",
            operation: "kebab",
            config: {},
          }),
          context,
        );

        expect(mockCreateCleaningTransforms).toHaveBeenCalledWith(
          "ds-test-001",
          [
            {
              name: "kebab on name",
              transform_type: "clean",
              target_column: "name",
              expression_config: { operation: "case", mode: "kebab" },
            },
          ],
        );
      });

      it("should map map_values to transform_type 'map'", async () => {
        const { context } = createTestTable();
        mockCreateCleaningTransforms.mockResolvedValue(undefined);

        const mappings = [{ from: "A", to: "Category A" }];
        await executeToolCall(
          createToolCall("applyCleaningTransform", {
            column: "category",
            operation: "map_values",
            config: { mappings },
          }),
          context,
        );

        expect(mockCreateCleaningTransforms).toHaveBeenCalledWith(
          "ds-test-001",
          [
            {
              name: "map_values on category",
              transform_type: "map",
              target_column: "category",
              expression_config: { operation: "map_values", mappings },
            },
          ],
        );
      });
    });

    describe("Scenario: Undo cleaning transform", () => {
      it("should disable most recent active cleaning transform when no ID given", async () => {
        const { context } = createTestTable();
        context.transforms = [
          {
            id: "tf-1",
            name: "Old trim",
            status: "enabled",
            transform_type: "clean",
            target_column: "name",
            created_at: "2025-01-01T00:00:00Z",
          },
          {
            id: "tf-2",
            name: "New trim",
            status: "enabled",
            transform_type: "clean",
            target_column: "category",
            created_at: "2025-06-01T00:00:00Z",
          },
        ];
        mockUpdateTransform.mockResolvedValue(undefined);

        const message = await executeToolCall(
          createToolCall("undoCleaningTransform", { action: "disable" }),
          context,
        );

        // Should disable the most recent (tf-2)
        expect(mockUpdateTransform).toHaveBeenCalledWith(
          "ds-test-001",
          "tf-2",
          { status: "disabled" },
        );
        expect(message).toBe("Disabled transform: New trim");
      });

      it("should delete a specific transform by ID", async () => {
        const { context } = createTestTable();
        context.transforms = [
          {
            id: "tf-1",
            name: "Old trim",
            status: "enabled",
            transform_type: "clean",
            target_column: "name",
            created_at: "2025-01-01T00:00:00Z",
          },
        ];
        mockUpdateTransform.mockResolvedValue(undefined);

        const message = await executeToolCall(
          createToolCall("undoCleaningTransform", {
            action: "delete",
            transformId: "tf-1",
          }),
          context,
        );

        expect(mockUpdateTransform).toHaveBeenCalledWith(
          "ds-test-001",
          "tf-1",
          { status: "deleted" },
        );
        expect(message).toBe("Deleted transform: Old trim");
      });

      it("should return message when no active transforms to undo", async () => {
        const { context } = createTestTable();
        context.transforms = [];

        const message = await executeToolCall(
          createToolCall("undoCleaningTransform", { action: "disable" }),
          context,
        );

        expect(mockUpdateTransform).not.toHaveBeenCalled();
        expect(message).toBe("No active cleaning transforms to undo.");
      });

      it("should skip filter transforms when finding most recent", async () => {
        const { context } = createTestTable();
        context.transforms = [
          {
            id: "tf-filter",
            name: "A filter",
            status: "enabled",
            transform_type: "filter",
            created_at: "2025-06-01T00:00:00Z",
          },
          {
            id: "tf-clean",
            name: "A cleaning",
            status: "enabled",
            transform_type: "clean",
            target_column: "name",
            created_at: "2025-01-01T00:00:00Z",
          },
        ];
        mockUpdateTransform.mockResolvedValue(undefined);

        const message = await executeToolCall(
          createToolCall("undoCleaningTransform", { action: "disable" }),
          context,
        );

        expect(mockUpdateTransform).toHaveBeenCalledWith(
          "ds-test-001",
          "tf-clean",
          { status: "disabled" },
        );
        expect(message).toBe("Disabled transform: A cleaning");
      });
    });

    describe("Scenario: Re-enable cleaning transform", () => {
      it("should re-enable most recently disabled cleaning transform", async () => {
        const { context } = createTestTable();
        context.transforms = [
          {
            id: "tf-1",
            name: "Disabled trim",
            status: "disabled",
            transform_type: "clean",
            target_column: "name",
            created_at: "2025-01-01T00:00:00Z",
          },
        ];
        mockUpdateTransform.mockResolvedValue(undefined);

        const message = await executeToolCall(
          createToolCall("reEnableCleaningTransform", {}),
          context,
        );

        expect(mockUpdateTransform).toHaveBeenCalledWith(
          "ds-test-001",
          "tf-1",
          { status: "enabled" },
        );
        expect(message).toBe("Re-enabled transform: Disabled trim");
      });

      it("should re-enable a specific transform by ID", async () => {
        const { context } = createTestTable();
        context.transforms = [
          {
            id: "tf-1",
            name: "Disabled trim",
            status: "disabled",
            transform_type: "clean",
            target_column: "name",
            created_at: "2025-01-01T00:00:00Z",
          },
          {
            id: "tf-2",
            name: "Disabled case",
            status: "disabled",
            transform_type: "clean",
            target_column: "category",
            created_at: "2025-06-01T00:00:00Z",
          },
        ];
        mockUpdateTransform.mockResolvedValue(undefined);

        const message = await executeToolCall(
          createToolCall("reEnableCleaningTransform", { transformId: "tf-1" }),
          context,
        );

        expect(mockUpdateTransform).toHaveBeenCalledWith(
          "ds-test-001",
          "tf-1",
          { status: "enabled" },
        );
        expect(message).toBe("Re-enabled transform: Disabled trim");
      });

      it("should return message when no disabled transforms to re-enable", async () => {
        const { context } = createTestTable();
        context.transforms = [];

        const message = await executeToolCall(
          createToolCall("reEnableCleaningTransform", {}),
          context,
        );

        expect(mockUpdateTransform).not.toHaveBeenCalled();
        expect(message).toBe("No disabled cleaning transforms to re-enable.");
      });
    });

    describe("Scenario: Cleaning tool API error", () => {
      it("should return error message when preview API fails", async () => {
        const { context } = createTestTable();
        mockPreviewCleaningTransform.mockRejectedValue(
          new Error("Column type mismatch"),
        );

        const message = await executeToolCall(
          createToolCall("trimWhitespace", { column: "amount" }),
          context,
        );

        expect(message).toBe("Error: Column type mismatch");
      });

      it("should return error message when create API fails", async () => {
        const { context } = createTestTable();
        mockCreateCleaningTransforms.mockRejectedValue(
          new Error("Network error"),
        );

        const message = await executeToolCall(
          createToolCall("renameColumn", {
            column: "name",
            newName: "Product",
          }),
          context,
        );

        expect(message).toBe("Error: Network error");
      });
    });
  });
});
