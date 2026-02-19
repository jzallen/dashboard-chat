"""Domain type definitions for dashboard-chat.

These types are implementation-agnostic and represent business concepts.
"""

from __future__ import annotations
from functools import reduce
from typing import Any

import ibis
import ibis.expr.types

from app.utils.sql_functions import title_case, snake_case, kebab_case


class QueryBuilderJSON(dict):
    """Value object for RAQB query builder JSON.

    Extends dict so it serializes naturally with asdict() and JSON serializers.
    Provides conversion to Ibis expressions.
    """

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> QueryBuilderJSON | None:
        """Create from dictionary, returning None if empty."""
        if not d:
            return None
        return cls(d)

    def as_ibis_filter(self, table: ibis.Table) -> ibis.expr.types.BooleanValue:
        """Convert to Ibis filter expression."""
        return self._process_group(self, table)

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


class CleaningExpression:
    """Converts expression_config JSON into Ibis column expressions.

    Mirrors QueryBuilderJSON.as_ibis_filter() but produces column expressions
    (for SELECT/mutate) rather than boolean filters (for WHERE).

    Supported operations:
    - trim: strip leading/trailing whitespace
    - case: upper/lower/title case standardization
    - fill_null: replace NULL values with a fill value
    - map_values: CASE WHEN value mapping chain
    - alias: column rename (handled separately in _build_table RENAME stage)
    """

    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self._validate()

    def _validate(self) -> None:
        """Validate expression_config structure."""
        if not self.config:
            raise ValueError("expression_config must not be empty")

        operation = self.config.get("operation")
        if not operation:
            raise ValueError("expression_config must contain an 'operation' field")

        valid_ops = ("trim", "case", "fill_null", "map_values", "alias")
        if operation not in valid_ops:
            raise ValueError(
                f"Unsupported operation '{operation}'. "
                f"Valid operations: {', '.join(valid_ops)}"
            )

        if operation == "case":
            mode = self.config.get("mode")
            if not mode:
                raise ValueError("'mode' field is required for the 'case' operation")
            valid_modes = ("upper", "lower", "title", "snake", "kebab")
            if mode not in valid_modes:
                raise ValueError(
                    f"Invalid case mode '{mode}'. Valid modes: {', '.join(valid_modes)}"
                )

        if operation == "fill_null":
            if "fill_value" not in self.config:
                raise ValueError("'fill_value' field is required for the 'fill_null' operation")

        if operation == "map_values":
            if "mappings" not in self.config:
                raise ValueError("'mappings' field is required for the 'map_values' operation")

        if operation == "alias":
            if "alias" not in self.config:
                raise ValueError("'alias' field is required for the 'alias' operation")

    @property
    def operation(self) -> str:
        return self.config["operation"]

    @property
    def alias_name(self) -> str | None:
        """Return the alias name if this is an alias operation."""
        if self.operation == "alias":
            return self.config["alias"]
        return None

    def as_ibis_expr(self, table: ibis.Table, column: str) -> ibis.Expr:
        """Convert to an Ibis column expression.

        Args:
            table: The Ibis table to reference columns from.
            column: The target column name to transform.

        Returns:
            An Ibis expression for the transformed column value.
        """
        col = table[column]

        match self.operation:
            case "trim":
                return col.strip()
            case "case":
                mode = self.config["mode"]
                match mode:
                    case "upper":
                        return col.upper()
                    case "lower":
                        return col.lower()
                    case "title":
                        return title_case(col)
                    case "snake":
                        return snake_case(col)
                    case "kebab":
                        return kebab_case(col)
            case "fill_null":
                fill_value = self.config["fill_value"]
                return col.fill_null(fill_value)
            case "map_values":
                mappings = self.config.get("mappings", [])
                if not mappings:
                    return col
                case_expr = ibis.case()
                for mapping in mappings:
                    case_expr = case_expr.when(col == mapping["from"], mapping["to"])
                return case_expr.else_(col).end()
            case "alias":
                raise ValueError(
                    "Alias transforms are handled in the RENAME stage, "
                    "not via as_ibis_expr()"
                )

    def to_display_sql(self, column: str) -> str:
        """Generate a display-friendly SQL expression string.

        Used for storage in expression_sql — human-readable, not for execution.
        Actual execution uses as_ibis_expr() in _build_table().
        """
        match self.operation:
            case "trim":
                return f"TRIM({column})"
            case "case":
                mode = self.config["mode"]
                match mode:
                    case "upper":
                        return f"UPPER({column})"
                    case "lower":
                        return f"LOWER({column})"
                    case "title":
                        return f"title_case({column})"
                    case "snake":
                        return f"snake_case({column})"
                    case "kebab":
                        return f"kebab_case({column})"
            case "fill_null":
                fill_value = self.config["fill_value"]
                if isinstance(fill_value, str):
                    # Escape single quotes for display
                    escaped = fill_value.replace("'", "''")
                    return f"COALESCE({column}, '{escaped}')"
                return f"COALESCE({column}, {fill_value})"
            case "map_values":
                mappings = self.config.get("mappings", [])
                if not mappings:
                    return column
                when_clauses = []
                for m in mappings:
                    from_val = m["from"].replace("'", "''")
                    to_val = m["to"].replace("'", "''")
                    when_clauses.append(f"WHEN {column} = '{from_val}' THEN '{to_val}'")
                return f"CASE {' '.join(when_clauses)} ELSE {column} END"
            case "alias":
                alias = self.config["alias"]
                return f'{column} AS "{alias}"'
        return column


# Type aliases for SQL strings
SQLCondition = str  # SQL WHERE condition (e.g., "age > 18 AND status = 'active'")
SQLQuery = str  # Full SQL SELECT statement
