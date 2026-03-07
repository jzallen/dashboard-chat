import { describe, expect, it } from "vitest";

import type { RAQBOperator } from "../types";
import {
  BOOLEAN_OPERATORS,
  NUMERIC_OPERATORS,
  RAQB_TO_TANSTACK_OPERATOR,
  SELECT_OPERATORS,
  STRING_OPERATORS,
  mapOperator,
  requiresSpecialHandling,
} from "../operators";

describe("RAQB_TO_TANSTACK_OPERATOR lookup table", () => {
  it("maps equality operators", () => {
    expect(RAQB_TO_TANSTACK_OPERATOR.equal).toBe("equals");
    expect(RAQB_TO_TANSTACK_OPERATOR.not_equal).toBe("notEquals");
    expect(RAQB_TO_TANSTACK_OPERATOR.select_equals).toBe("equals");
    expect(RAQB_TO_TANSTACK_OPERATOR.select_not_equals).toBe("notEquals");
  });

  it("maps comparison operators", () => {
    expect(RAQB_TO_TANSTACK_OPERATOR.less).toBe("lt");
    expect(RAQB_TO_TANSTACK_OPERATOR.less_or_equal).toBe("lte");
    expect(RAQB_TO_TANSTACK_OPERATOR.greater).toBe("gt");
    expect(RAQB_TO_TANSTACK_OPERATOR.greater_or_equal).toBe("gte");
  });

  it("maps string operators", () => {
    expect(RAQB_TO_TANSTACK_OPERATOR.like).toBe("contains");
    expect(RAQB_TO_TANSTACK_OPERATOR.not_like).toBe("notEquals");
    expect(RAQB_TO_TANSTACK_OPERATOR.starts_with).toBe("contains");
    expect(RAQB_TO_TANSTACK_OPERATOR.ends_with).toBe("contains");
  });

  it("returns null for operators requiring special handling", () => {
    const specialOps: RAQBOperator[] = [
      "between",
      "not_between",
      "is_null",
      "is_not_null",
      "is_empty",
      "is_not_empty",
      "select_any_in",
      "select_not_any_in",
    ];
    for (const op of specialOps) {
      expect(RAQB_TO_TANSTACK_OPERATOR[op]).toBeNull();
    }
  });
});

describe("requiresSpecialHandling", () => {
  it("returns true for null-mapped operators", () => {
    expect(requiresSpecialHandling("between")).toBe(true);
    expect(requiresSpecialHandling("not_between")).toBe(true);
    expect(requiresSpecialHandling("is_null")).toBe(true);
    expect(requiresSpecialHandling("is_not_null")).toBe(true);
    expect(requiresSpecialHandling("is_empty")).toBe(true);
    expect(requiresSpecialHandling("is_not_empty")).toBe(true);
    expect(requiresSpecialHandling("select_any_in")).toBe(true);
    expect(requiresSpecialHandling("select_not_any_in")).toBe(true);
  });

  it("returns false for directly mapped operators", () => {
    expect(requiresSpecialHandling("equal")).toBe(false);
    expect(requiresSpecialHandling("not_equal")).toBe(false);
    expect(requiresSpecialHandling("less")).toBe(false);
    expect(requiresSpecialHandling("greater")).toBe(false);
    expect(requiresSpecialHandling("like")).toBe(false);
  });
});

describe("mapOperator", () => {
  it("returns the TanStack operator for a mapped RAQB operator", () => {
    expect(mapOperator("equal")).toBe("equals");
    expect(mapOperator("not_equal")).toBe("notEquals");
    expect(mapOperator("less")).toBe("lt");
    expect(mapOperator("greater_or_equal")).toBe("gte");
    expect(mapOperator("like")).toBe("contains");
  });

  it("returns null for operators requiring special handling", () => {
    expect(mapOperator("between")).toBeNull();
    expect(mapOperator("is_null")).toBeNull();
    expect(mapOperator("select_any_in")).toBeNull();
  });
});

describe("operator group arrays", () => {
  it("NUMERIC_OPERATORS includes comparison and equality ops", () => {
    expect(NUMERIC_OPERATORS).toContain("equal");
    expect(NUMERIC_OPERATORS).toContain("less");
    expect(NUMERIC_OPERATORS).toContain("greater_or_equal");
    expect(NUMERIC_OPERATORS).toContain("between");
    expect(NUMERIC_OPERATORS).not.toContain("like");
  });

  it("STRING_OPERATORS includes text-oriented ops", () => {
    expect(STRING_OPERATORS).toContain("like");
    expect(STRING_OPERATORS).toContain("not_like");
    expect(STRING_OPERATORS).toContain("starts_with");
    expect(STRING_OPERATORS).toContain("ends_with");
    expect(STRING_OPERATORS).toContain("is_empty");
    expect(STRING_OPERATORS).not.toContain("between");
  });

  it("BOOLEAN_OPERATORS contains only equal and not_equal", () => {
    expect(BOOLEAN_OPERATORS).toEqual(["equal", "not_equal"]);
  });

  it("SELECT_OPERATORS contains select-prefixed ops", () => {
    expect(SELECT_OPERATORS).toContain("select_equals");
    expect(SELECT_OPERATORS).toContain("select_not_equals");
    expect(SELECT_OPERATORS).toContain("select_any_in");
    expect(SELECT_OPERATORS).toContain("select_not_any_in");
    expect(SELECT_OPERATORS).not.toContain("equal");
  });
});
