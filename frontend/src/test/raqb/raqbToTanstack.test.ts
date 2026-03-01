import { describe, expect,it } from "vitest";

import type { RAQBTree } from "@/raqb";
import {
  countRules,
  isEmptyTree,
  raqbToExtendedFilters,
  raqbToTanstackFilters,
} from "@/raqb";

describe("raqbToTanstack", () => {
  describe("Feature: Convert RAQB JSON to TanStack filters", () => {
    describe("Scenario: Convert single rule", () => {
      it("should convert an equal operator rule", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["Electronics"],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "category",
          value: { operator: "equals", value: "Electronics" },
        });
      });

      it("should convert a greater operator rule", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "amount",
                operator: "greater",
                value: [100],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "amount",
          value: { operator: "gt", value: 100 },
        });
      });

      it("should convert a less_or_equal operator rule", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "quantity",
                operator: "less_or_equal",
                value: [50],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "quantity",
          value: { operator: "lte", value: 50 },
        });
      });

      it("should convert a like (contains) operator rule", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "name",
                operator: "like",
                value: ["Widget"],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "name",
          value: { operator: "contains", value: "Widget" },
        });
      });
    });

    describe("Scenario: Convert multiple rules in AND group", () => {
      it("should convert all rules in an AND group", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["Electronics"],
              },
            },
            rule2: {
              type: "rule",
              properties: {
                field: "amount",
                operator: "greater",
                value: [100],
              },
            },
          },
        };

        const { filters, warnings } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(2);
        expect(filters).toContainEqual({
          id: "category",
          value: { operator: "equals", value: "Electronics" },
        });
        expect(filters).toContainEqual({
          id: "amount",
          value: { operator: "gt", value: 100 },
        });
        expect(warnings).toHaveLength(0);
      });
    });

    describe("Scenario: Convert OR group", () => {
      it("should convert rules in an OR group (flattened) and emit warning", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "OR" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["Electronics"],
              },
            },
            rule2: {
              type: "rule",
              properties: {
                field: "category",
                operator: "equal",
                value: ["Hardware"],
              },
            },
          },
        };

        const { filters, warnings } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(2);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toBe(
          "OR group flattened to AND — filter results may be broader than expected"
        );
      });
    });

    describe("Scenario: Convert nested groups", () => {
      it("should flatten nested groups into individual filters", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "inStock",
                operator: "equal",
                value: [true],
              },
            },
            group1: {
              type: "group",
              properties: { conjunction: "OR" },
              children1: {
                rule2: {
                  type: "rule",
                  properties: {
                    field: "category",
                    operator: "equal",
                    value: ["Electronics"],
                  },
                },
                rule3: {
                  type: "rule",
                  properties: {
                    field: "category",
                    operator: "equal",
                    value: ["Hardware"],
                  },
                },
              },
            },
          },
        };

        const { filters, warnings } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(3);
        expect(filters).toContainEqual({
          id: "inStock",
          value: { operator: "equals", value: true },
        });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toBe(
          "OR group flattened to AND — filter results may be broader than expected"
        );
      });

      it("should handle deeply nested groups", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            group1: {
              type: "group",
              properties: { conjunction: "AND" },
              children1: {
                group2: {
                  type: "group",
                  properties: { conjunction: "AND" },
                  children1: {
                    rule1: {
                      type: "rule",
                      properties: {
                        field: "amount",
                        operator: "greater",
                        value: [50],
                      },
                    },
                  },
                },
              },
            },
          },
        };

        const { filters, warnings } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "amount",
          value: { operator: "gt", value: 50 },
        });
        expect(warnings).toHaveLength(0);
      });
    });

    describe("Scenario: Handle special operators", () => {
      it("should convert is_null to equals empty", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "name",
                operator: "is_null",
                value: [],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "name",
          value: { operator: "equals", value: "" },
        });
      });

      it("should convert is_not_null to notEquals empty", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "name",
                operator: "is_not_null",
                value: [],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "name",
          value: { operator: "notEquals", value: "" },
        });
      });

      it("should convert select_equals to equals", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "status",
                operator: "select_equals",
                value: ["active"],
              },
            },
          },
        };

        const { filters } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(1);
        expect(filters[0]).toEqual({
          id: "status",
          value: { operator: "equals", value: "active" },
        });
      });
    });

    describe("Scenario: Handle empty trees", () => {
      it("should return empty filters for empty tree", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {},
        };

        const { filters, warnings } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(0);
        expect(warnings).toHaveLength(0);
      });

      it("should return empty filters for tree with undefined children", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
        };

        const { filters, warnings } = raqbToTanstackFilters(tree);

        expect(filters).toHaveLength(0);
        expect(warnings).toHaveLength(0);
      });
    });
  });

  describe("Feature: Extended filter conversion", () => {
    it("should preserve RAQB operator in extended filters", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "amount",
              operator: "greater",
              value: [100],
            },
          },
        },
      };

      const filters = raqbToExtendedFilters(tree);

      expect(filters).toHaveLength(1);
      expect(filters[0].raqbOperator).toBe("greater");
      expect(filters[0].conjunction).toBe("AND");
    });
  });

  describe("Feature: Tree utilities", () => {
    describe("isEmptyTree", () => {
      it("should return true for empty tree", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {},
        };

        expect(isEmptyTree(tree)).toBe(true);
      });

      it("should return true for tree with only empty nested groups", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            group1: {
              type: "group",
              properties: { conjunction: "AND" },
              children1: {},
            },
          },
        };

        expect(isEmptyTree(tree)).toBe(true);
      });

      it("should return false for tree with rules", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "amount",
                operator: "greater",
                value: [100],
              },
            },
          },
        };

        expect(isEmptyTree(tree)).toBe(false);
      });
    });

    describe("countRules", () => {
      it("should count rules correctly", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: { field: "a", operator: "equal", value: [1] },
            },
            rule2: {
              type: "rule",
              properties: { field: "b", operator: "equal", value: [2] },
            },
            group1: {
              type: "group",
              properties: { conjunction: "OR" },
              children1: {
                rule3: {
                  type: "rule",
                  properties: { field: "c", operator: "equal", value: [3] },
                },
              },
            },
          },
        };

        expect(countRules(tree)).toBe(3);
      });

      it("should return 0 for empty tree", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
        };

        expect(countRules(tree)).toBe(0);
      });
    });
  });
});
