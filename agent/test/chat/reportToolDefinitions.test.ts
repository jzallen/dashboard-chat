/**
 * Milestone-2 (MR-3) input-surface contract — agent Zod tool schemas.
 *
 * Drives the schema-violation scenario from
 * `docs/feature/ibis-as-only-sql-compiler/distill/milestone-2-report-ibis-compiler.feature`:
 *
 *   Scenario: A measure-creation call carrying a free-form expression field
 *     is rejected at the agent's tool-schema layer before reaching the
 *     backend
 *
 * Per ADR-026 §"Decision outcome" items 2 and 3 (and DWD-4) the agent's
 * tool schemas close the free-form-SQL surface by ABSENCE of the field plus
 * `.strict()`, not by `.refine()`-based content rejection. An LLM that
 * emits `{ name, sqlDefinition: 'X', ... }` must fail `.safeParse` with an
 * `unrecognized_keys` issue naming the offending field, before the agent
 * has any chance to forward the payload to the backend.
 *
 * This is the inner-loop test for that contract. The outer-loop file-content
 * check lives at
 * `tests/acceptance/ibis-as-only-sql-compiler/test_milestone_2_schema_violation.py`.
 *
 * Test budget: 2 behaviours (rejection of dropped fields, acceptance of the
 * stripped-down happy path) × 2 = 4 unit tests. Three rejection cases are
 * parametrised via `it.each` (one parametrised behaviour). Three happy-path
 * cases likewise. Total: 2 parametrised tests covering 2 behaviours.
 */
import { describe, expect, it } from "vitest";
import type { ZodIssue } from "zod";

import { getReportTools } from "../../lib/chat/reportToolDefinitions";

type RejectionCase = {
  toolName: "createReport" | "addDimension" | "addMeasure";
  payload: Record<string, unknown>;
  rejectedField: string;
  description: string;
};

const rejectionCases: RejectionCase[] = [
  {
    toolName: "createReport",
    payload: {
      name: "loose_revenue",
      sqlDefinition: "SELECT 1",
      reportType: "fact",
      sourceRefs: [{ id: "ds-1", type: "dataset" }],
      domain: "Finance",
    },
    rejectedField: "sqlDefinition",
    description: "createReport rejects sqlDefinition (ADR-026 item 2)",
  },
  {
    toolName: "addDimension",
    payload: {
      name: "region",
      semanticType: "categorical",
      expr: "lower(region)",
    },
    rejectedField: "expr",
    description: "addDimension rejects expr (ADR-026 item 3)",
  },
  {
    toolName: "addMeasure",
    payload: {
      name: "tax_adjusted_revenue",
      semanticType: "sum",
      expr: "revenue * tax_rate",
    },
    rejectedField: "expr",
    description: "addMeasure rejects expr (ADR-026 item 3)",
  },
];

type AcceptanceCase = {
  toolName: "createReport" | "addDimension" | "addMeasure";
  payload: Record<string, unknown>;
  description: string;
};

const acceptanceCases: AcceptanceCase[] = [
  {
    toolName: "createReport",
    payload: {
      name: "monthly_revenue",
      reportType: "fact",
      sourceRefs: [{ id: "ds-1", type: "dataset" }],
      domain: "Finance",
    },
    description: "createReport accepts a payload without sqlDefinition",
  },
  {
    toolName: "addDimension",
    payload: { name: "region", semanticType: "categorical" },
    description: "addDimension accepts a payload without expr",
  },
  {
    toolName: "addMeasure",
    payload: { name: "revenue", semanticType: "sum" },
    description: "addMeasure accepts a payload without expr",
  },
];

function collectNames(issues: ZodIssue[]): string[] {
  // `unrecognized_keys` issues carry the offending names on `.keys`; other
  // issues carry path segments. We accept either surface so the contract
  // works against any Zod 3.x patch version.
  const names: string[] = [];
  for (const issue of issues) {
    const keys = (issue as { keys?: unknown }).keys;
    if (Array.isArray(keys)) {
      for (const k of keys) if (typeof k === "string") names.push(k);
    }
    if (Array.isArray(issue.path)) {
      for (const p of issue.path) if (typeof p === "string") names.push(p);
    }
  }
  return names;
}

describe("report tool definitions — Zod schema input-surface contract", () => {
  it.each(rejectionCases)(
    "$description",
    ({ toolName, payload, rejectedField }) => {
      const tools = getReportTools();
      const schema = tools[toolName].parameters;
      const result = schema.safeParse(payload);

      expect(result.success).toBe(false);
      if (result.success) return; // narrow for TS

      const issueCodes = result.error.issues.map((i) => i.code);
      expect(issueCodes).toContain("unrecognized_keys");

      const names = collectNames(result.error.issues);
      expect(names).toContain(rejectedField);
    },
  );

  it.each(acceptanceCases)("$description", ({ toolName, payload }) => {
    const tools = getReportTools();
    const schema = tools[toolName].parameters;
    const result = schema.safeParse(payload);

    expect(result.success).toBe(true);
  });
});
