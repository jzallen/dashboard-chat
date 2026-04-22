import { CASE_OPERATIONS, type TableSchema, type ToolDefinition } from "./types";

// ============================================================================
// Tool Definitions
// ============================================================================

export function getToolDefinitions(tableSchema: TableSchema): ToolDefinition[] {
  const columnNames = tableSchema.columns.map((c) => c.id);
  const textColumnNames = tableSchema.columns
    .filter((c) => c.type === "string")
    .map((c) => c.id);
  const allColumnNames = columnNames;
  const activeTransformIds =
    tableSchema.activeCleaningTransforms?.map((t) => t.id) ?? [];
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
    // ========================================================================
    // Data Cleaning Tools
    // ========================================================================
    {
      name: "trimWhitespace",
      description:
        "Trim leading and trailing whitespace from all values in a text column. This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: textColumnNames,
            description: "Text column to trim whitespace from",
          },
        },
        required: ["column"],
      },
    },
    {
      name: "standardizeCase",
      description:
        "Standardize text casing in a column (upper, lower, or title case). This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: textColumnNames,
            description: "Text column to standardize casing on",
          },
          mode: {
            type: "string",
            enum: [...CASE_OPERATIONS],
            description:
              "Case mode: upper (ALL CAPS), lower (all lowercase), title (First Letter Caps), snake (snake_case, e.g. Product Name -> product_name; also known as underscore case), kebab (kebab-case, e.g. Product Name -> product-name; also known as hyphen case)",
          },
        },
        required: ["column", "mode"],
      },
    },
    {
      name: "renameColumn",
      description:
        "Rename a column's display name (creates an alias). This applies immediately without preview.",
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: allColumnNames,
            description: "Column to rename",
          },
          newName: {
            type: "string",
            description: "New display name for the column",
          },
        },
        required: ["column", "newName"],
      },
    },
    {
      name: "fillNulls",
      description:
        "Fill null or empty values in a column with a specified value. This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: allColumnNames,
            description: "Column to fill null values in",
          },
          fillValue: {
            type: "string",
            description: "Value to replace nulls/empty values with",
          },
        },
        required: ["column", "fillValue"],
      },
    },
    {
      name: "mapValues",
      description:
        "Map specific values in a column to new values (exact match replacement). This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: textColumnNames,
            description: "Text column to map values in",
          },
          mappings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: {
                  type: "string",
                  description: "Original value to match (exact match)",
                },
                to: {
                  type: "string",
                  description: "Replacement value",
                },
              },
              required: ["from", "to"],
            },
            description: "Array of value mappings (from → to)",
          },
        },
        required: ["column", "mappings"],
      },
    },
    {
      name: "applyCleaningTransform",
      description:
        "Apply a previously previewed cleaning operation permanently to the dataset. Call this after a preview tool (trimWhitespace, standardizeCase, fillNulls, mapValues) when the user confirms.",
      parameters: {
        type: "object",
        properties: {
          column: {
            type: "string",
            enum: allColumnNames,
            description: "Column the cleaning operation targets",
          },
          operation: {
            type: "string",
            enum: [
              "trim",
              "upper",
              "lower",
              "title",
              "snake",
              "kebab",
              "fill_null",
              "map_values",
            ],
            description: "The cleaning operation to apply",
          },
          config: {
            type: "object",
            description:
              "Operation configuration (same as the previewed operation)",
            additionalProperties: true,
          },
        },
        required: ["column", "operation", "config"],
      },
    },
    {
      name: "undoCleaningTransform",
      description:
        "Undo a cleaning transform by disabling (reversible) or deleting (permanent) it. If no transformId is provided, targets the most recently applied cleaning transform.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["disable", "delete"],
            description:
              "Whether to disable (reversible, can re-enable later) or permanently delete the transform",
          },
          transformId: {
            type: "string",
            ...(activeTransformIds.length > 0
              ? { enum: activeTransformIds }
              : {}),
            description:
              "ID of the cleaning transform to undo. If omitted, undoes the most recent one.",
          },
        },
        required: ["action"],
      },
    },
    {
      name: "reEnableCleaningTransform",
      description:
        "Re-enable a previously disabled cleaning transform.",
      parameters: {
        type: "object",
        properties: {
          transformId: {
            type: "string",
            description:
              "ID of the disabled cleaning transform to re-enable. If omitted, re-enables the most recently disabled one.",
          },
        },
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
      let base = `  - "${c.id}" (${c.type})`;
      if (c.alias) {
        base = `  - "${c.alias}" (${c.type}, actual column: ${c.id})`;
      }
      const profileStr = formatProfile(c.profile);
      return profileStr ? `${base} -- ${profileStr}` : base;
    })
    .join("\n");

  const activeFilterLines =
    tableSchema.activeFilters && tableSchema.activeFilters.length > 0
      ? `\nACTIVE FILTERS:\n${tableSchema.activeFilters.map((f) => `  - ${f.column} ${f.operator} ${f.value}`).join("\n")}\n`
      : "\nNo active filters.\n";

  const formatContextLines = tableSchema.formatContext
    ? `\nFORMAT CONTEXT:\n${tableSchema.formatContext}\n`
    : "";

  const activeCleaningLines =
    tableSchema.activeCleaningTransforms &&
    tableSchema.activeCleaningTransforms.length > 0
      ? `\nACTIVE CLEANING TRANSFORMS:\n${tableSchema.activeCleaningTransforms
          .map(
            (t) =>
              `  - [${t.id}] ${t.column}: ${t.operation}${t.details ? ` (${t.details})` : ""}`,
          )
          .join("\n")}\n`
      : "\nNo active cleaning transforms.\n";

  return `You are a helpful assistant that controls a data table. You can filter, sort, add rows, delete rows, and clean data using the provided tools.

CURRENT TABLE SCHEMA:
${columnDescriptions}

Total rows: ${tableSchema.rowCount}
${formatContextLines}${activeFilterLines}${activeCleaningLines}
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

7. For DATA CLEANING operations (trim, case, fill nulls, map values):
   - ALWAYS call BOTH the preview tool AND "applyCleaningTransform" in the SAME response
   - First call the preview tool ("trimWhitespace", "standardizeCase", "fillNulls", or "mapValues") to show the user what will change
   - Then call "applyCleaningTransform" with the same column, operation, and config to persist the change
   - Both tool calls MUST be included together — never call a preview tool without also calling applyCleaningTransform
   - Use "renameColumn" to change a column's display name (applies immediately, no preview needed)
   - Case modes: upper, lower, title, snake (underscore case), kebab (hyphen case)

8. To UNDO a cleaning transform, use "undoCleaningTransform". To re-enable, use "reEnableCleaningTransform".

9. When the user refers to a column by its alias (display name), always use the actual column name (shown as "actual column: X" in the schema) for tool calls.

10. Do NOT guess fill values for null columns — always ask the user what value to use.

Be concise. Confirm what action you're taking.${getLayerSection(tableSchema)}`;
}

// ============================================================================
// Layer-Specific Prompt Sections
// ============================================================================

// ============================================================================
// View Context System Prompt
// ============================================================================

export function getViewSystemPrompt(): string {
  return `You are a helpful assistant that helps users build and modify Views. A View is a derived dataset defined by SQL that combines data from one or more source datasets or other views.

You can use the following view mutation tools:
- createView: Create a new view from source datasets/views
- addColumn / removeColumn: Add or remove columns
- addJoin / removeJoin: Add or remove joins between sources
- addFilter / removeFilter: Add or remove filter conditions
- renameView / deleteView: Rename or delete the view
- setMaterialization: Set how the view is materialized (view, table, ephemeral, incremental)
- castColumn: Change a column's display type
- setGrain: Set the time dimension and grouping dimensions

GUARDRAILS:
- This is a View context. You can use view mutation tools only.
- If the user asks to add a row, delete a row, or edit a cell, respond with: "This is a View — its data is derived from SQL. To add or modify data, switch to the source dataset."
- Before using setGrain, verify that the timeColumn is a date, time, or datetime typed column. Warn the user if no time-typed column exists.
- Metric columns (aggregated values) cannot be grain dimensions — only raw or categorical columns can be dimensions.
- When adding joins, warn the user if the join could create a circular dependency (e.g., View A joins View B which already depends on View A).

Be concise. Confirm what action you're taking.`;
}

// ============================================================================
// Report Context System Prompt
// ============================================================================

export function getReportSystemPrompt(tableSchema?: TableSchema | null): string {
  const layerSection = tableSchema ? getLayerSection(tableSchema) : "";

  return `You are a helpful assistant that helps users build and modify Reports. A Report is a mart-layer model that defines final business metrics, dimensions, and entities from source datasets and views.

You can use the following report mutation tools:
- createReport: Create a new report from source datasets/views
- renameReport / deleteReport: Rename or delete the report
- addDimension / removeDimension: Add or remove dimension columns (categorical or time-based grouping attributes)
- addMeasure / removeMeasure: Add or remove measure columns (numeric aggregations: sum, count, avg, min, max)
- addFilter / removeFilter: Add or remove filter conditions on the SQL definition
- addJoin / removeJoin: Add or remove joins to source datasets/views
- setMaterialization: Set how the report is materialized (view, table, ephemeral, incremental)
- setDomain: Set the business domain (e.g. Finance, Sales, Clinical)
- setReportType: Set the report type (fact for metrics/events, dimension for descriptive attributes)
- suggestStructure: Analyze source columns and suggest dimensions/measures/entities

GUARDRAILS:
- This is a Report context. You can use report mutation tools only.
- Reports are mart-layer models. Source references must be datasets or views — NEVER other reports (no mart-to-mart dependencies).
- Semantic column metadata must use valid role/type pairs:
  - entity → semantic_type: "foreign"
  - dimension → semantic_type: "categorical" or "time"
  - measure → semantic_type: "sum", "count", "count_distinct", "avg", "min", "max"
- Time dimensions require a time_granularity (day, week, month, quarter, year).
- When using suggestStructure, explain your reasoning for each suggestion and let the user confirm before applying.
- If the user asks to add a row, delete a row, or edit a cell, respond with: "This is a Report — its data is derived from SQL. To add or modify data, switch to the source dataset."

COLUMN CLASSIFICATION HEURISTICS (for suggestStructure):
- Columns ending in _id → entity (semantic_type: foreign)
- Columns ending in _at, _date, _timestamp → dimension (semantic_type: time)
- Numeric columns (int, float, decimal, numeric) → measure candidates
- String/varchar columns → dimension (semantic_type: categorical)

Be concise. Confirm what action you're taking.${layerSection}`;
}

// ============================================================================
// Conversational System Prompt (no tools)
// ============================================================================

export function getConversationalSystemPrompt(): string {
  return `You are a helpful assistant. No dataset or view is currently selected, so you cannot perform table or view operations directly. You can answer questions, help with general tasks, and guide the user to select a dataset or view to work with.

DATASET RESOLUTION:
When the user references a dataset by name (e.g. "show me the patients table", "filter the sales data", "open inventory"), use the "resolve_dataset" tool with the dataset name. The system will search for a matching dataset and load its schema automatically.

If the user asks about filtering, sorting, or data operations without mentioning a specific dataset name, suggest they select a dataset or view first.`;
}

// ============================================================================
// Layer-Specific Prompt Sections
// ============================================================================

function getLayerSection(tableSchema: TableSchema): string {
  const ctx = tableSchema.layerContext;
  if (!ctx) return "";

  switch (ctx.layer) {
    case "dataset":
      return `

LAYER CONTEXT: You are working on a Dataset (staging layer).
ALLOWED operations: Column cleaning (trim, case, fill nulls, map values), filtering, sorting, column renaming.
PROHIBITED: JOINs, GROUP BY, aggregate functions (SUM, COUNT, AVG, etc.), window functions, subqueries. These belong in a View (intermediate layer).
If the user asks for JOINs or aggregations, explain that these operations belong in a View and offer to help create one.`;

    case "view": {
      const sources = ctx.sourceSchemas?.join(", ") ?? "";
      return `

LAYER CONTEXT: You are working on View "${ctx.modelName}" (intermediate layer).
Current SQL: ${ctx.sqlDefinition ?? ""}
Source models: ${sources}
ALLOWED operations: JOINs, GROUP BY, aggregations (SUM, COUNT, AVG, MIN, MAX), window functions, CTEs, UNION/UNION ALL, subqueries, CASE WHEN, column aliasing, row filtering.
PROHIBITED: MetricFlow semantic annotations. These belong in a Report (mart layer).`;
    }

    case "report": {
      const sources = ctx.sourceSchemas?.join(", ") ?? "";
      return `

LAYER CONTEXT: You are working on Report "${ctx.modelName}" (mart layer).
Current SQL: ${ctx.sqlDefinition ?? ""}
Source models: ${sources}
ALLOWED operations: All View operations plus final denormalization joins, metric calculations, lite aggregations.
You may also suggest semantic column metadata (entity/dimension/measure roles) for MetricFlow readiness.`;
    }

    default:
      return "";
  }
}
