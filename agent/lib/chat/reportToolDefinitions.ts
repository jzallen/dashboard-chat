import { tool } from "ai";
import { z } from "zod";

const SEMANTIC_ROLES = ["entity", "dimension", "measure"] as const;

const SEMANTIC_TYPES_DIMENSION = ["categorical", "time"] as const;
const SEMANTIC_TYPES_MEASURE = [
  "sum",
  "count",
  "count_distinct",
  "avg",
  "min",
  "max",
] as const;
const SEMANTIC_TYPES_ENTITY = ["foreign"] as const;

const MATERIALIZATION_STRATEGIES = [
  "view",
  "table",
  "ephemeral",
  "incremental",
] as const;

const REPORT_TYPES = ["fact", "dimension"] as const;

const FILTER_OPERATORS = [
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "IN",
  "NOT IN",
  "IS NULL",
  "IS NOT NULL",
  "LIKE",
  "NOT LIKE",
] as const;

const JOIN_TYPES = ["INNER", "LEFT", "RIGHT", "FULL"] as const;

const TIME_GRANULARITIES = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const;

export function getReportTools() {
  return {
    createReport: tool({
      description:
        "Create a new report from one or more source datasets or views. Sources must be datasets or views — never other reports.",
      // ADR-026 §Decision-outcome item 2 (and DWD-4): the report's SQL is
      // composed by the ReportIbisCompiler from columns_metadata. The
      // free-form `sqlDefinition` field is removed from this tool surface;
      // .strict() turns an LLM call carrying the dropped field into a
      // parse-time `unrecognized_keys` error rather than a silent strip.
      parameters: z
        .object({
          name: z.string().describe("Name for the new report"),
          reportType: z
            .enum(REPORT_TYPES)
            .describe("Report type: 'fact' for metrics/events, 'dimension' for descriptive attributes"),
          sourceRefs: z
            .array(
              z.object({
                id: z.string().describe("Source dataset or view ID"),
                type: z
                  .enum(["dataset", "view"])
                  .describe("Source type — must be 'dataset' or 'view', never 'report'"),
              }),
            )
            .describe("Array of source references"),
          domain: z.string().describe("Business domain (e.g. 'Finance', 'Sales', 'Organization')"),
          description: z.string().optional().describe("Optional description"),
          materialization: z
            .enum(MATERIALIZATION_STRATEGIES)
            .optional()
            .describe("Materialization strategy (default: 'view')"),
        })
        .strict(),
    }),
    renameReport: tool({
      description: "Rename the current report",
      parameters: z.object({
        newName: z.string().describe("New name for the report"),
      }),
    }),
    deleteReport: tool({
      description: "Delete the current report",
      parameters: z.object({
        reportId: z.string().describe("ID of the report to delete"),
      }),
    }),
    addDimension: tool({
      description:
        "Add a dimension column to the report's columns_metadata. Dimensions are categorical or time-based grouping attributes.",
      // ADR-026 §Decision-outcome item 3: no free-text `expr` field on the
      // tool surface. Future semantic computations land as typed
      // ComputedField variants. .strict() makes the absence enforceable at
      // parse time.
      parameters: z
        .object({
          name: z.string().describe("Column name"),
          semanticType: z
            .enum(SEMANTIC_TYPES_DIMENSION)
            .describe("Semantic type: 'categorical' or 'time'"),
          description: z.string().optional().describe("Column description"),
          timeGranularity: z
            .enum(TIME_GRANULARITIES)
            .optional()
            .describe("Time granularity (required for time dimensions)"),
        })
        .strict(),
    }),
    removeDimension: tool({
      description: "Remove a dimension column from the report's columns_metadata",
      parameters: z.object({
        name: z.string().describe("Name of the dimension to remove"),
      }),
    }),
    addMeasure: tool({
      description:
        "Add a measure column to the report's columns_metadata. Measures are numeric aggregations.",
      // ADR-026 §Decision-outcome item 3: no free-text `expr` field on the
      // tool surface. Future semantic computations land as typed
      // ComputedField variants. .strict() makes the absence enforceable at
      // parse time.
      parameters: z
        .object({
          name: z.string().describe("Column name"),
          semanticType: z
            .enum(SEMANTIC_TYPES_MEASURE)
            .describe("Aggregation type: sum, count, count_distinct, avg, min, max"),
          description: z.string().optional().describe("Column description"),
        })
        .strict(),
    }),
    removeMeasure: tool({
      description: "Remove a measure column from the report's columns_metadata",
      parameters: z.object({
        name: z.string().describe("Name of the measure to remove"),
      }),
    }),
    addFilter: tool({
      description: "Add a filter condition to the report's SQL definition",
      parameters: z.object({
        column: z.string().describe("Column to filter on"),
        operator: z.enum(FILTER_OPERATORS).describe("Filter operator"),
        value: z
          .string()
          .optional()
          .describe("Value to compare against (omit for IS NULL / IS NOT NULL)"),
      }),
    }),
    removeFilter: tool({
      description: "Remove a filter condition from the report's SQL definition",
      parameters: z.object({
        column: z.string().describe("Column whose filter should be removed"),
      }),
    }),
    addJoin: tool({
      description:
        "Add a join to the report. Sources must be datasets or views — never other reports.",
      parameters: z.object({
        rightRef: z.object({
          id: z.string().describe("Source dataset or view ID"),
          type: z
            .enum(["dataset", "view"])
            .describe("Source type — must be 'dataset' or 'view', never 'report'"),
        }).describe("Right-side source to join"),
        leftColumn: z.string().describe("Column on the left side of the join"),
        rightColumn: z.string().describe("Column on the right side of the join"),
        joinType: z
          .enum(JOIN_TYPES)
          .optional()
          .describe("Join type (default: INNER)"),
      }),
    }),
    removeJoin: tool({
      description: "Remove a join from the report by the right-side source ID",
      parameters: z.object({
        rightRefId: z.string().describe("ID of the right-side source to remove"),
      }),
    }),
    setMaterialization: tool({
      description: "Set the materialization strategy for the report",
      parameters: z.object({
        strategy: z
          .enum(MATERIALIZATION_STRATEGIES)
          .describe("Materialization strategy"),
      }),
    }),
    setDomain: tool({
      description: "Set the business domain for the report (e.g. 'Finance', 'Sales', 'Clinical')",
      parameters: z.object({
        domain: z.string().describe("Business domain name"),
      }),
    }),
    setReportType: tool({
      description:
        "Set the report type: 'fact' for metrics/events, 'dimension' for descriptive attributes",
      parameters: z.object({
        reportType: z
          .enum(REPORT_TYPES)
          .describe("Report type"),
      }),
    }),
    suggestStructure: tool({
      description:
        "Analyze the report's source columns and suggest dimensions, measures, and entities based on naming conventions and data types. Returns suggestions for the user to review — does not modify the report.",
      parameters: z.object({
        sourceColumns: z
          .array(
            z.object({
              name: z.string().describe("Column name"),
              type: z.string().describe("Column data type"),
            }),
          )
          .describe("Source columns to analyze"),
      }),
    }),
  };
}
