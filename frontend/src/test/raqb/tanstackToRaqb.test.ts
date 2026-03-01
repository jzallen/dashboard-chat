import { describe, expect, it } from "vitest";

import { raqbToTanstackFilters } from "@/raqb";
import {
  filterTableToRaqb,
  generateFilterDescription,
} from "@/raqb/tanstackToRaqb";

describe("tanstackToRaqb", () => {
  describe("filterTableToRaqb", () => {
    it("should convert a single equals filter", () => {
      const result = filterTableToRaqb({
        column: "status",
        operator: "equals",
        value: "active",
      });

      expect(result.type).toBe("group");
      expect(result.properties.conjunction).toBe("AND");
      const rule = Object.values(result.children1!)[0];
      expect(rule.type).toBe("rule");
      if (rule.type === "rule") {
        expect(rule.properties.field).toBe("status");
        expect(rule.properties.operator).toBe("equal");
        expect(rule.properties.value).toEqual(["active"]);
      }
    });

    it("should convert a numeric gt filter", () => {
      const result = filterTableToRaqb({
        column: "amount",
        operator: "gt",
        value: 100,
      });

      const rule = Object.values(result.children1!)[0];
      if (rule.type === "rule") {
        expect(rule.properties.field).toBe("amount");
        expect(rule.properties.operator).toBe("greater");
        expect(rule.properties.value).toEqual([100]);
      }
    });

    it("should convert a contains filter", () => {
      const result = filterTableToRaqb({
        column: "name",
        operator: "contains",
        value: "Widget",
      });

      const rule = Object.values(result.children1!)[0];
      if (rule.type === "rule") {
        expect(rule.properties.field).toBe("name");
        expect(rule.properties.operator).toBe("like");
        expect(rule.properties.value).toEqual(["Widget"]);
      }
    });

    it("should convert a between filter with array value", () => {
      const result = filterTableToRaqb({
        column: "price",
        operator: "between",
        value: [10, 100],
      });

      const rule = Object.values(result.children1!)[0];
      if (rule.type === "rule") {
        expect(rule.properties.field).toBe("price");
        expect(rule.properties.operator).toBe("between");
        expect(rule.properties.value).toEqual([10, 100]);
      }
    });

    it("should fall back to equal for unknown operators", () => {
      const result = filterTableToRaqb({
        column: "col",
        operator: "unknownOp",
        value: "val",
      });

      const rule = Object.values(result.children1!)[0];
      if (rule.type === "rule") {
        expect(rule.properties.operator).toBe("equal");
      }
    });

    it("should wrap scalar value in array", () => {
      const result = filterTableToRaqb({
        column: "status",
        operator: "equals",
        value: "active",
      });

      const rule = Object.values(result.children1!)[0];
      if (rule.type === "rule") {
        expect(rule.properties.value).toEqual(["active"]);
      }
    });

    it("should verify all standard operator mappings", () => {
      const mappings: Array<{ input: string; expected: string }> = [
        { input: "equals", expected: "equal" },
        { input: "notEquals", expected: "not_equal" },
        { input: "gt", expected: "greater" },
        { input: "gte", expected: "greater_or_equal" },
        { input: "lt", expected: "less" },
        { input: "lte", expected: "less_or_equal" },
        { input: "between", expected: "between" },
        { input: "contains", expected: "like" },
        { input: "startsWith", expected: "starts_with" },
        { input: "endsWith", expected: "ends_with" },
        { input: "isNull", expected: "is_null" },
        { input: "isNotNull", expected: "is_not_null" },
        { input: "selectEquals", expected: "select_equals" },
        { input: "selectAnyIn", expected: "select_any_in" },
      ];

      for (const { input, expected } of mappings) {
        const result = filterTableToRaqb({
          column: "col",
          operator: input,
          value: "v",
        });

        const rule = Object.values(result.children1!)[0];
        if (rule.type === "rule") {
          expect(rule.properties.operator).toBe(expected);
        }
      }
    });
  });

  describe("generateFilterDescription", () => {
    it("should describe an equals filter", () => {
      const desc = generateFilterDescription({
        column: "status",
        operator: "equals",
        value: "active",
      });

      expect(desc).toBe("status equals active");
    });

    it("should describe a gt filter", () => {
      const desc = generateFilterDescription({
        column: "amount",
        operator: "gt",
        value: 100,
      });

      expect(desc).toBe("amount is greater than 100");
    });

    it("should describe a between filter with array value", () => {
      const desc = generateFilterDescription({
        column: "price",
        operator: "between",
        value: [10, 100],
      });

      expect(desc).toBe("price is between 10 and 100");
    });

    it("should describe a contains filter", () => {
      const desc = generateFilterDescription({
        column: "name",
        operator: "contains",
        value: "Widget",
      });

      expect(desc).toBe("name contains Widget");
    });

    it("should fall back to operator name for unknown operators", () => {
      const desc = generateFilterDescription({
        column: "col",
        operator: "customOp",
        value: "val",
      });

      expect(desc).toBe("col customOp val");
    });
  });

  describe("round-trip: RAQB -> TanStack -> RAQB", () => {
    it("should preserve semantic equivalence for an equals filter", () => {
      const originalRaqb = filterTableToRaqb({
        column: "category",
        operator: "equals",
        value: "Electronics",
      });

      const { filters } = raqbToTanstackFilters(originalRaqb);
      expect(filters).toHaveLength(1);

      const tanstackFilter = filters[0];
      const roundTripped = filterTableToRaqb({
        column: tanstackFilter.id,
        operator: (tanstackFilter.value as { operator: string }).operator,
        value: (tanstackFilter.value as { value: unknown }).value,
      });

      const originalRule = Object.values(originalRaqb.children1!)[0];
      const roundTrippedRule = Object.values(roundTripped.children1!)[0];

      if (originalRule.type === "rule" && roundTrippedRule.type === "rule") {
        expect(roundTrippedRule.properties.field).toBe(originalRule.properties.field);
        expect(roundTrippedRule.properties.operator).toBe(originalRule.properties.operator);
        expect(roundTrippedRule.properties.value).toEqual(originalRule.properties.value);
      }
    });

    it("should preserve semantic equivalence for a gt filter", () => {
      const originalRaqb = filterTableToRaqb({
        column: "amount",
        operator: "gt",
        value: 50,
      });

      const { filters } = raqbToTanstackFilters(originalRaqb);
      const tanstackFilter = filters[0];
      const roundTripped = filterTableToRaqb({
        column: tanstackFilter.id,
        operator: (tanstackFilter.value as { operator: string }).operator,
        value: (tanstackFilter.value as { value: unknown }).value,
      });

      const originalRule = Object.values(originalRaqb.children1!)[0];
      const roundTrippedRule = Object.values(roundTripped.children1!)[0];

      if (originalRule.type === "rule" && roundTrippedRule.type === "rule") {
        expect(roundTrippedRule.properties.field).toBe(originalRule.properties.field);
        expect(roundTrippedRule.properties.operator).toBe(originalRule.properties.operator);
        expect(roundTrippedRule.properties.value).toEqual(originalRule.properties.value);
      }
    });
  });
});
