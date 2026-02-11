import type { TableSchema, ToolDefinition } from "./types";

// ============================================================================
// Tool Definitions
// ============================================================================

export function getToolDefinitions(tableSchema: TableSchema): ToolDefinition[] {
  const columnNames = tableSchema.columns.map((c) => c.id);
  const columnDescriptions = tableSchema.columns
    .map((c) => `"${c.id}" (${c.type})`)
    .join(", ");

  return [
    {
      name: "sortTable",
      description: `Sort table by a column. Available columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: columnNames,
            description: "Column ID to sort by",
          },
          direction: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction: ascending or descending",
          },
        },
        required: ["column", "direction"],
      },
    },
    {
      name: "addRow",
      description: `Add a new row to the table. Columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          data: {
            type: "object",
            description:
              "Key-value pairs for the new row. Keys should match column IDs.",
            additionalProperties: true,
          },
        },
        required: ["data"],
      },
    },
    {
      name: "deleteRow",
      description:
        "Delete a row from the table by searching for matching text across all columns.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description:
              "Text to search for. Matches against any column value in the row.",
          },
        },
        required: ["search"],
      },
    },
    {
      name: "clearFilters",
      description: "Remove all active filters from the table",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "clearSort",
      description: "Remove sorting from the table",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "filterTable",
      description: `Add a filter to the table. Use this to ADD a new filter condition. Available columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: columnNames,
            description: "Column ID to filter by",
          },
          operator: {
            type: "string",
            enum: [
              "equals",
              "notEquals",
              "contains",
              "startsWith",
              "endsWith",
              "gt",
              "gte",
              "lt",
              "lte",
              "between",
            ],
            description:
              "Comparison operator. Use gt/gte/lt/lte for numbers, contains/startsWith/endsWith for text.",
          },
          value: {
            description:
              "Value to compare against. Use number for numeric comparisons, string for text. For 'between', use an array of two numbers.",
          },
        },
        required: ["column", "operator", "value"],
      },
    },
    {
      name: "replaceColumnFilter",
      description: `Replace all existing filters on a column with new condition(s). Use when the user wants to CHANGE an existing filter. Preserves filters on other columns. Available columns: ${columnDescriptions}`,
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: columnNames,
            description: "Column to replace filters on",
          },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                operator: {
                  type: "string",
                  enum: [
                    "equals",
                    "notEquals",
                    "contains",
                    "startsWith",
                    "endsWith",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                    "between",
                  ],
                },
                value: {
                  description: "Value to compare against",
                },
              },
              required: ["operator", "value"],
            },
            description:
              "ALL desired conditions for this column (include unchanged ones too)",
          },
        },
        required: ["column", "filters"],
      },
    },
  ];
}

// ============================================================================
// System Prompt
// ============================================================================

export function formatProfile(profile: { type: string; unique_count?: number; sample_values?: string[]; min?: number | string; max?: number | string; mean?: number; true_count?: number; false_count?: number; null_count?: number } | undefined): string {
  if (!profile) return "";

  switch (profile.type) {
    case "text": {
      const values = (profile.sample_values ?? []).slice(0, 10);
      const parts: string[] = [];
      if (values.length > 0) parts.push(`values: ${values.join(", ")}`);
      if (profile.unique_count != null) parts.push(`${profile.unique_count} unique`);
      return parts.join(" | ");
    }
    case "number": {
      const parts: string[] = [];
      if (profile.min != null && profile.max != null) parts.push(`range: ${profile.min} to ${profile.max}`);
      if (profile.mean != null) parts.push(`mean: ${typeof profile.mean === "number" ? profile.mean.toFixed(2) : profile.mean}`);
      return parts.join(", ");
    }
    case "datetime": {
      if (profile.min != null && profile.max != null) return `range: ${profile.min} to ${profile.max}`;
      return "";
    }
    case "boolean": {
      const parts: string[] = [];
      if (profile.true_count != null) parts.push(`true: ${profile.true_count}`);
      if (profile.false_count != null) parts.push(`false: ${profile.false_count}`);
      return parts.join(", ");
    }
    default:
      return "";
  }
}

export function getSystemPrompt(tableSchema: TableSchema): string {
  const columnDescriptions = tableSchema.columns
    .map((c) => {
      const base = `  - "${c.id}" (${c.type})`;
      const profileStr = formatProfile((c as any).profile);
      return profileStr ? `${base} -- ${profileStr}` : base;
    })
    .join("\n");

  const activeFilterLines =
    tableSchema.activeFilters && tableSchema.activeFilters.length > 0
      ? `\nACTIVE FILTERS:\n${tableSchema.activeFilters.map((f) => `  - ${f.column} ${f.operator} ${f.value}`).join("\n")}\n`
      : "\nNo active filters.\n";

  return `You are a helpful assistant that controls a data table. You can filter, sort, add rows, and delete rows using the provided tools.

CURRENT TABLE SCHEMA:
${columnDescriptions}

Total rows: ${tableSchema.rowCount}
${activeFilterLines}
When the user mentions a value that matches a known column value from the profile above, use it for exact filtering with the "equals" operator.

INSTRUCTIONS:
1. To ADD a new filter, use "filterTable":
   - Example: "show items over $50" → filterTable(column="amount", operator="gt", value=50)
   - Operators: equals, notEquals, contains, startsWith, endsWith, gt, gte, lt, lte, between
   - For multiple filters on different columns, call filterTable multiple times

2. To CHANGE an existing filter, use "replaceColumnFilter":
   - Example: "use 10 instead of 7" → replaceColumnFilter(column="tenure_years", filters=[{operator:"gt", value:3}, {operator:"lt", value:10}])
   - Example: "show west instead of east" → replaceColumnFilter(column="region", filters=[{operator:"equals", value:"West"}])
   - Include ALL desired conditions for that column (not just the changed one)
   - Filters on other columns are preserved automatically

   IMPORTANT: When the user asks to change, update, or replace an existing filter value, always use "replaceColumnFilter" — NOT "filterTable". Using "filterTable" would add a conflicting condition instead of replacing the old one.

3. For sorting, use "sortTable" with column and direction ("asc" or "desc").
4. For adding rows, use "addRow" with data matching the column schema.
5. For deleting rows, use "deleteRow" with search text that matches the row.
6. Use "clearFilters" or "clearSort" to reset the table view.

Be concise. Confirm what action you're taking.`;
}
