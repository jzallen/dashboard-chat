import { describe, expect,it } from "vitest";

import { customFilterFn } from "@/table-tools";

// Helper to create a mock row
function createMockRow(values: Record<string, unknown>) {
  return {
    getValue: (columnId: string) => values[columnId],
  };
}

describe("customFilterFn", () => {
  describe("Feature: Table Filtering", () => {
    describe("Scenario: Filter by numeric column with greater than operator", () => {
      it("should return true when amount is greater than the filter value", () => {
        const row = createMockRow({ amount: 15 });
        const result = customFilterFn(row, "amount", {
          operator: "gt",
          value: 10,
        });
        expect(result).toBe(true);
      });

      it("should return false when amount is equal to the filter value", () => {
        const row = createMockRow({ amount: 10 });
        const result = customFilterFn(row, "amount", {
          operator: "gt",
          value: 10,
        });
        expect(result).toBe(false);
      });

      it("should return false when amount is less than the filter value", () => {
        const row = createMockRow({ amount: 5 });
        const result = customFilterFn(row, "amount", {
          operator: "gt",
          value: 10,
        });
        expect(result).toBe(false);
      });

      it("should handle string numbers", () => {
        const row = createMockRow({ amount: "15" });
        const result = customFilterFn(row, "amount", {
          operator: "gt",
          value: "10",
        });
        expect(result).toBe(true);
      });
    });

    describe("Scenario: Filter by numeric column with less than operator", () => {
      it("should return true when quantity is less than the filter value", () => {
        const row = createMockRow({ quantity: 30 });
        const result = customFilterFn(row, "quantity", {
          operator: "lt",
          value: 50,
        });
        expect(result).toBe(true);
      });

      it("should return false when quantity is equal to the filter value", () => {
        const row = createMockRow({ quantity: 50 });
        const result = customFilterFn(row, "quantity", {
          operator: "lt",
          value: 50,
        });
        expect(result).toBe(false);
      });

      it("should return false when quantity is greater than the filter value", () => {
        const row = createMockRow({ quantity: 75 });
        const result = customFilterFn(row, "quantity", {
          operator: "lt",
          value: 50,
        });
        expect(result).toBe(false);
      });
    });

    describe("Scenario: Filter by string column with equals operator", () => {
      it("should return true when category exactly equals the filter value", () => {
        const row = createMockRow({ category: "Electronics" });
        const result = customFilterFn(row, "category", {
          operator: "equals",
          value: "Electronics",
        });
        expect(result).toBe(true);
      });

      it("should return true when category equals the filter value case-insensitively", () => {
        const row = createMockRow({ category: "Electronics" });
        const result = customFilterFn(row, "category", {
          operator: "equals",
          value: "electronics",
        });
        expect(result).toBe(true);
      });

      it("should return false when category does not equal the filter value", () => {
        const row = createMockRow({ category: "Hardware" });
        const result = customFilterFn(row, "category", {
          operator: "equals",
          value: "Electronics",
        });
        expect(result).toBe(false);
      });
    });

    describe("Scenario: Filter by string column with contains operator", () => {
      it("should return true when name contains the filter value", () => {
        const row = createMockRow({ name: "Super Widget Pro" });
        const result = customFilterFn(row, "name", {
          operator: "contains",
          value: "Widget",
        });
        expect(result).toBe(true);
      });

      it("should return true when name contains the filter value case-insensitively", () => {
        const row = createMockRow({ name: "Widget Pro" });
        const result = customFilterFn(row, "name", {
          operator: "contains",
          value: "widget",
        });
        expect(result).toBe(true);
      });

      it("should return false when name does not contain the filter value", () => {
        const row = createMockRow({ name: "Gadget X" });
        const result = customFilterFn(row, "name", {
          operator: "contains",
          value: "Widget",
        });
        expect(result).toBe(false);
      });
    });

    describe("Scenario: Filter by boolean column", () => {
      it("should return true when inStock equals true (boolean)", () => {
        const row = createMockRow({ inStock: true });
        const result = customFilterFn(row, "inStock", {
          operator: "equals",
          value: true,
        });
        expect(result).toBe(true);
      });

      it('should return true when inStock equals "true" (string)', () => {
        const row = createMockRow({ inStock: true });
        const result = customFilterFn(row, "inStock", {
          operator: "equals",
          value: "true",
        });
        expect(result).toBe(true);
      });

      it("should return false when inStock is false and filtering for true", () => {
        const row = createMockRow({ inStock: false });
        const result = customFilterFn(row, "inStock", {
          operator: "equals",
          value: true,
        });
        expect(result).toBe(false);
      });

      it("should return true when inStock equals false", () => {
        const row = createMockRow({ inStock: false });
        const result = customFilterFn(row, "inStock", {
          operator: "equals",
          value: false,
        });
        expect(result).toBe(true);
      });
    });
  });
});
