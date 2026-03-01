import { describe, expect,it } from "vitest";

import type { RAQBTree } from "@/raqb";
import { raqbToParameterizedSql,raqbToSql } from "@/raqb";

describe("toSql", () => {
  describe("Feature: Convert RAQB JSON to SQL WHERE clause", () => {
    describe("Scenario: Convert single rule with different operators", () => {
      it("should convert equal operator", () => {
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

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"category" = 'Electronics'`);
      });

      it("should convert not_equal operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "status",
                operator: "not_equal",
                value: ["inactive"],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"status" <> 'inactive'`);
      });

      it("should convert greater operator with number", () => {
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

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"amount" > 100`);
      });

      it("should convert less_or_equal operator", () => {
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

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"quantity" <= 50`);
      });

      it("should convert between operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "price",
                operator: "between",
                value: [10, 100],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"price" BETWEEN 10 AND 100`);
      });

      it("should convert like operator (contains)", () => {
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

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"name" ILIKE '%Widget%'`);
      });

      it("should convert starts_with operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "name",
                operator: "starts_with",
                value: ["Pro"],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"name" ILIKE 'Pro%'`);
      });

      it("should convert ends_with operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "name",
                operator: "ends_with",
                value: ["Edition"],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"name" ILIKE '%Edition'`);
      });

      it("should convert is_null operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "deleted_at",
                operator: "is_null",
                value: [],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"deleted_at" IS NULL`);
      });

      it("should convert is_not_null operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "email",
                operator: "is_not_null",
                value: [],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"email" IS NOT NULL`);
      });

      it("should convert is_empty operator", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "notes",
                operator: "is_empty",
                value: [],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`("notes" IS NULL OR "notes" = '')`);
      });

      it("should convert select_any_in operator (IN clause)", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "status",
                operator: "select_any_in",
                value: ["active", "pending", "review"],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"status" IN ('active', 'pending', 'review')`);
      });

      it("should handle boolean values", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "is_active",
                operator: "equal",
                value: [true],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"is_active" = TRUE`);
      });

      it("should handle null values", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "deleted_at",
                operator: "equal",
                value: [null],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`"deleted_at" = NULL`);
      });
    });

    describe("Scenario: Convert multiple rules with AND conjunction", () => {
      it("should join rules with AND", () => {
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

        const sql = raqbToSql(tree);

        expect(sql).toContain(`"category" = 'Electronics'`);
        expect(sql).toContain(` AND `);
        expect(sql).toContain(`"amount" > 100`);
      });
    });

    describe("Scenario: Convert multiple rules with OR conjunction", () => {
      it("should join rules with OR", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "OR" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "status",
                operator: "equal",
                value: ["active"],
              },
            },
            rule2: {
              type: "rule",
              properties: {
                field: "status",
                operator: "equal",
                value: ["pending"],
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toContain(`"status" = 'active'`);
        expect(sql).toContain(` OR `);
        expect(sql).toContain(`"status" = 'pending'`);
      });
    });

    describe("Scenario: Convert nested groups", () => {
      it("should wrap nested groups in parentheses", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            rule1: {
              type: "rule",
              properties: {
                field: "in_stock",
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

        const sql = raqbToSql(tree);

        expect(sql).toContain(`"in_stock" = TRUE`);
        expect(sql).toContain(`("category" = 'Electronics' OR "category" = 'Hardware')`);
      });
    });

    describe("Scenario: Handle NOT groups", () => {
      it("should wrap NOT groups correctly", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {
            group1: {
              type: "group",
              properties: { conjunction: "OR", not: true },
              children1: {
                rule1: {
                  type: "rule",
                  properties: {
                    field: "status",
                    operator: "equal",
                    value: ["deleted"],
                  },
                },
                rule2: {
                  type: "rule",
                  properties: {
                    field: "status",
                    operator: "equal",
                    value: ["archived"],
                  },
                },
              },
            },
          },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe(`NOT ("status" = 'deleted' OR "status" = 'archived')`);
      });
    });

    describe("Scenario: Handle empty trees", () => {
      it("should return 1=1 for empty tree", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
          children1: {},
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe("1=1");
      });

      it("should return 1=1 for tree with undefined children", () => {
        const tree: RAQBTree = {
          type: "group",
          properties: { conjunction: "AND" },
        };

        const sql = raqbToSql(tree);

        expect(sql).toBe("1=1");
      });
    });
  });

  describe("Feature: SQL Injection Prevention", () => {
    it("should escape single quotes in string values", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "name",
              operator: "equal",
              value: ["O'Brien's Store"],
            },
          },
        },
      };

      const sql = raqbToSql(tree);

      expect(sql).toBe(`"name" = 'O''Brien''s Store'`);
      expect(sql).not.toContain("O'Brien");
    });

    it("should escape double quotes in field names", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: 'col"name',
              operator: "equal",
              value: ["test"],
            },
          },
        },
      };

      const sql = raqbToSql(tree);

      expect(sql).toBe(`"col""name" = 'test'`);
    });

    it("should properly quote field names with special characters", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "user-id",
              operator: "equal",
              value: ["test"],
            },
          },
        },
      };

      const sql = raqbToSql(tree);

      expect(sql).toBe(`"user-id" = 'test'`);
    });

    it("should reject NaN values", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "amount",
              operator: "greater",
              value: [NaN],
            },
          },
        },
      };

      expect(() => raqbToSql(tree)).toThrow("Invalid numeric value");
    });

    it("should reject Infinity values", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "amount",
              operator: "greater",
              value: [Infinity],
            },
          },
        },
      };

      expect(() => raqbToSql(tree)).toThrow("Invalid numeric value");
    });
  });

  describe("Feature: Parameterized queries", () => {
    it("should generate parameterized SQL with placeholders", () => {
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

      const result = raqbToParameterizedSql(tree);

      expect(result.sql).toContain("$1");
      expect(result.sql).toContain("$2");
      expect(result.params).toHaveLength(2);
      expect(result.params).toContain("Electronics");
      expect(result.params).toContain(100);
    });

    it("should handle between operator with two parameters", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "price",
              operator: "between",
              value: [10, 100],
            },
          },
        },
      };

      const result = raqbToParameterizedSql(tree);

      expect(result.sql).toBe(`"price" BETWEEN $1 AND $2`);
      expect(result.params).toEqual([10, 100]);
    });

    it("should handle IN clause with multiple parameters", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "status",
              operator: "select_any_in",
              value: ["a", "b", "c"],
            },
          },
        },
      };

      const result = raqbToParameterizedSql(tree);

      expect(result.sql).toBe(`"status" IN ($1, $2, $3)`);
      expect(result.params).toEqual(["a", "b", "c"]);
    });

    it("should return empty params for is_null operators", () => {
      const tree: RAQBTree = {
        type: "group",
        properties: { conjunction: "AND" },
        children1: {
          rule1: {
            type: "rule",
            properties: {
              field: "deleted_at",
              operator: "is_null",
              value: [],
            },
          },
        },
      };

      const result = raqbToParameterizedSql(tree);

      expect(result.sql).toBe(`"deleted_at" IS NULL`);
      expect(result.params).toEqual([]);
    });
  });

  describe("Feature: Custom identifier quoting", () => {
    it("should always use double-quote SQL escaping for identifiers", () => {
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

      const sql = raqbToSql(tree, { identifierQuote: "`" });

      expect(sql).toBe(`"amount" > 100`);
    });
  });
});
