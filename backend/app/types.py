"""Domain type definitions for dashboard-chat.

These types are implementation-agnostic and represent business concepts.
"""

from __future__ import annotations
from dataclasses import dataclass
from functools import reduce
from typing import Any

import ibis
import ibis.expr.types


@dataclass(frozen=True)
class QueryBuilderJSON:
    """Value object for RAQB query builder JSON.

    Encapsulates the JSON structure and provides conversion to Ibis expressions.
    """

    data: dict[str, Any]

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> QueryBuilderJSON | None:
        """Create from dictionary, returning None if empty."""
        if not d:
            return None
        return cls(data=d)

    def as_ibis_filter(self, table: ibis.Table) -> ibis.expr.types.BooleanValue:
        """Convert to Ibis filter expression."""
        return self._process_group(self.data, table)

    def _process_group(
        self, group: dict, table: ibis.Table
    ) -> ibis.expr.types.BooleanValue:
        children = group.get("children1", {})
        props = group.get("properties", {})
        conjunction = props.get("conjunction", "AND")
        is_negated = props.get("not", False)

        if not children:
            return ibis.literal(True)

        filters = [self._process_node(child, table) for child in children.values()]
        filters = [f for f in filters if f is not None]

        if not filters:
            return ibis.literal(True)

        # Reduce with conjunction
        combine = (
            (lambda a, b: a | b) if conjunction == "OR" else (lambda a, b: a & b)
        )
        result = reduce(combine, filters)

        return ~result if is_negated else result

    def _process_node(
        self, node: dict, table: ibis.Table
    ) -> ibis.expr.types.BooleanValue | None:
        if node.get("type") == "rule":
            return self._process_rule(node, table)
        elif node.get("type") == "group":
            return self._process_group(node, table)
        return None

    def _process_rule(
        self, rule: dict, table: ibis.Table
    ) -> ibis.expr.types.BooleanValue | None:
        props = rule.get("properties", {})
        field, operator = props.get("field"), props.get("operator")
        values = props.get("value", [])

        if not field or not operator:
            return None

        column = table[field]
        value = values[0] if values else None

        match operator:
            case "equal" | "select_equals":
                return column == value
            case "not_equal" | "select_not_equals":
                return column != value
            case "less":
                return column < value
            case "less_or_equal":
                return column <= value
            case "greater":
                return column > value
            case "greater_or_equal":
                return column >= value
            case "between" if len(values) >= 2:
                return column.between(values[0], values[1])
            case "not_between" if len(values) >= 2:
                return ~column.between(values[0], values[1])
            case "like":
                return column.like(f"%{value}%")
            case "not_like":
                return ~column.like(f"%{value}%")
            case "starts_with":
                return column.like(f"{value}%")
            case "ends_with":
                return column.like(f"%{value}")
            case "is_null":
                return column.isnull()
            case "is_not_null":
                return column.notnull()
            case "is_empty":
                return column.isnull() | (column == "")
            case "is_not_empty":
                return column.notnull() & (column != "")
            case "select_any_in":
                return column.isin(values)
            case "select_not_any_in":
                return ~column.isin(values)
            case _:
                return None


# Type aliases for SQL strings
SQLCondition = str  # SQL WHERE condition (e.g., "age > 18 AND status = 'active'")
SQLQuery = str  # Full SQL SELECT statement
