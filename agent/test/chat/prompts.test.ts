import { describe, expect, it } from "vitest";

import { getSystemPrompt } from "../../lib/chat/prompts";
import type { TableSchema } from "../../lib/chat/types";

function baseSchema(overrides?: Partial<TableSchema>): TableSchema {
  return {
    columns: [
      { id: "id", type: "number" },
      { id: "name", type: "string" },
    ],
    rowCount: 10,
    ...overrides,
  };
}

describe("getSystemPrompt", () => {
  describe("layer context", () => {
    it("should not include LAYER CONTEXT when no layerContext is provided", () => {
      const prompt = getSystemPrompt(baseSchema());
      expect(prompt).not.toContain("LAYER CONTEXT");
    });

    it("should include staging layer instructions for dataset layer", () => {
      const prompt = getSystemPrompt(
        baseSchema({
          layerContext: {
            layer: "dataset",
            modelName: "raw_orders",
          },
        })
      );

      expect(prompt).toContain("LAYER CONTEXT");
      expect(prompt).toContain("staging layer");
      expect(prompt).toContain("PROHIBITED: JOINs");
      expect(prompt).toContain("belong in a View");
    });

    it("should include intermediate layer instructions for view layer", () => {
      const prompt = getSystemPrompt(
        baseSchema({
          layerContext: {
            layer: "view",
            modelName: "orders_with_customers",
            sqlDefinition: "SELECT o.*, c.name FROM orders o JOIN customers c ON o.customer_id = c.id",
            sourceSchemas: ["stg_orders", "stg_customers"],
          },
        })
      );

      expect(prompt).toContain("LAYER CONTEXT");
      expect(prompt).toContain("intermediate layer");
      expect(prompt).toContain('View "orders_with_customers"');
      expect(prompt).toContain("ALLOWED operations: JOINs");
      expect(prompt).toContain("PROHIBITED: MetricFlow");
    });

    it("should include mart layer instructions for report layer", () => {
      const prompt = getSystemPrompt(
        baseSchema({
          layerContext: {
            layer: "report",
            modelName: "monthly_revenue",
            sqlDefinition: "SELECT month, SUM(amount) FROM orders GROUP BY month",
            sourceSchemas: ["int_orders"],
          },
        })
      );

      expect(prompt).toContain("LAYER CONTEXT");
      expect(prompt).toContain("mart layer");
      expect(prompt).toContain('Report "monthly_revenue"');
      expect(prompt).toContain("MetricFlow readiness");
    });

    it("should include SQL definition in view prompt", () => {
      const sql = "SELECT a.id, b.value FROM alpha a JOIN beta b ON a.id = b.alpha_id";
      const prompt = getSystemPrompt(
        baseSchema({
          layerContext: {
            layer: "view",
            modelName: "alpha_beta",
            sqlDefinition: sql,
          },
        })
      );

      expect(prompt).toContain(`Current SQL: ${sql}`);
    });

    it("should include source schemas in view prompt", () => {
      const prompt = getSystemPrompt(
        baseSchema({
          layerContext: {
            layer: "view",
            modelName: "combined",
            sourceSchemas: ["stg_orders", "stg_products", "stg_users"],
          },
        })
      );

      expect(prompt).toContain("Source models: stg_orders, stg_products, stg_users");
    });
  });
});
