"""Tests for transform service and RAQB to SQL conversion.

These tests verify the transform logic without requiring a database.
Run with: pytest backend/tests/test_pipelines.py
"""

import pytest

from app.services.transform_service import (
    raqb_to_sql,
    _convert_rule_to_sql,
    _process_group,
)


class TestRaqbToSql:
    """Tests for RAQB to SQL conversion."""

    def test_empty_tree_returns_always_true(self):
        """Empty tree should return 1=1."""
        tree = {"type": "group", "properties": {"conjunction": "AND"}}
        assert raqb_to_sql(tree) == "1=1"

    def test_empty_children_returns_always_true(self):
        """Tree with empty children should return 1=1."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {},
        }
        assert raqb_to_sql(tree) == "1=1"

    def test_single_equal_rule(self):
        """Single equal rule should generate correct SQL."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "category",
                        "operator": "equal",
                        "value": ["Electronics"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert sql == '"category" = \'Electronics\''

    def test_single_greater_rule(self):
        """Single greater rule should generate correct SQL."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "amount",
                        "operator": "greater",
                        "value": [100],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert sql == '"amount" > 100'

    def test_multiple_rules_and_conjunction(self):
        """Multiple rules with AND should be joined."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "category",
                        "operator": "equal",
                        "value": ["Electronics"],
                    },
                },
                "rule2": {
                    "type": "rule",
                    "properties": {
                        "field": "amount",
                        "operator": "greater",
                        "value": [100],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "AND" in sql
        assert '"category" = \'Electronics\'' in sql
        assert '"amount" > 100' in sql

    def test_multiple_rules_or_conjunction(self):
        """Multiple rules with OR should be joined."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "OR"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "status",
                        "operator": "equal",
                        "value": ["active"],
                    },
                },
                "rule2": {
                    "type": "rule",
                    "properties": {
                        "field": "status",
                        "operator": "equal",
                        "value": ["pending"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "OR" in sql

    def test_nested_group(self):
        """Nested groups should be wrapped in parentheses."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "active",
                        "operator": "equal",
                        "value": [True],
                    },
                },
                "group1": {
                    "type": "group",
                    "properties": {"conjunction": "OR"},
                    "children1": {
                        "rule2": {
                            "type": "rule",
                            "properties": {
                                "field": "category",
                                "operator": "equal",
                                "value": ["A"],
                            },
                        },
                        "rule3": {
                            "type": "rule",
                            "properties": {
                                "field": "category",
                                "operator": "equal",
                                "value": ["B"],
                            },
                        },
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "(" in sql  # Nested group should be wrapped
        assert "OR" in sql
        assert "AND" in sql

    def test_not_group(self):
        """NOT groups should be wrapped with NOT."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "group1": {
                    "type": "group",
                    "properties": {"conjunction": "OR", "not": True},
                    "children1": {
                        "rule1": {
                            "type": "rule",
                            "properties": {
                                "field": "status",
                                "operator": "equal",
                                "value": ["deleted"],
                            },
                        },
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert sql.startswith("NOT")


class TestOperatorConversion:
    """Tests for individual operator SQL generation."""

    def test_between_operator(self):
        """Between should generate BETWEEN ... AND ..."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "price",
                        "operator": "between",
                        "value": [10, 100],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "BETWEEN 10 AND 100" in sql

    def test_like_operator(self):
        """Like should generate ILIKE with wildcards."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "name",
                        "operator": "like",
                        "value": ["Widget"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "ILIKE '%Widget%'" in sql

    def test_starts_with_operator(self):
        """Starts with should generate ILIKE with trailing wildcard."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "name",
                        "operator": "starts_with",
                        "value": ["Pro"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "ILIKE 'Pro%'" in sql

    def test_is_null_operator(self):
        """Is null should generate IS NULL."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "deleted_at",
                        "operator": "is_null",
                        "value": [],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "IS NULL" in sql

    def test_select_any_in_operator(self):
        """Select any in should generate IN clause."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "status",
                        "operator": "select_any_in",
                        "value": ["active", "pending", "review"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "IN (" in sql
        assert "'active'" in sql
        assert "'pending'" in sql
        assert "'review'" in sql


class TestSqlInjectionPrevention:
    """Tests for SQL injection prevention."""

    def test_single_quote_escaping(self):
        """Single quotes should be escaped."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "name",
                        "operator": "equal",
                        "value": ["O'Brien's Store"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "O''Brien''s Store" in sql
        assert "O'Brien" not in sql

    def test_field_name_sanitization(self):
        """Field names should be sanitized."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": 'name"; DROP TABLE users; --',
                        "operator": "equal",
                        "value": ["test"],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "DROP TABLE" not in sql
        assert ";" not in sql or sql.count(";") == 0

    def test_boolean_values(self):
        """Boolean values should be converted to TRUE/FALSE."""
        tree = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "active",
                        "operator": "equal",
                        "value": [True],
                    },
                },
            },
        }
        sql = raqb_to_sql(tree)
        assert "TRUE" in sql


class TestVersioning:
    """Tests for pipeline versioning documentation."""

    def test_version_documented(self):
        """Document: Version should increment when RAQB changes.

        This is implemented in transform_service.update_pipeline().
        The service checks if raqb_json changed and increments version.
        """
        pass  # Documentation test

    def test_cached_sql_regenerated(self):
        """Document: cached_sql should regenerate when RAQB changes.

        This is implemented in transform_service.update_pipeline().
        When raqb_json is updated, cached_sql is regenerated from the new tree.
        """
        pass  # Documentation test
