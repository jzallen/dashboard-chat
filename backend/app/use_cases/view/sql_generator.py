"""SQL generator for View definitions."""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

if TYPE_CHECKING:
    from app.models.view import View


class ViewSQLGenerator:
    """Generates executable and display SQL from a View's structured definition."""

    BACKEND_TYPE_MAP: ClassVar[dict[str, str]] = {
        "text": "TEXT",
        "category": "TEXT",
        "id": "TEXT",
        "serial": "INTEGER",
        "integer": "INTEGER",
        "decimal": "DECIMAL",
        "boolean": "BOOLEAN",
        "date": "DATE",
        "time": "TIME",
        "datetime": "TIMESTAMP",
    }

    def generate_executable(self, view: View, ref_mode: bool = False) -> str:
        """Generate executable SQL from a View's structured definition.

        Args:
            view: View domain object.
            ref_mode: If True, use dbt ref() macros for source references.

        Returns:
            Executable SQL string.
        """
        source_alias_map = self._build_source_alias_map(view)
        select_clause = self._build_select(view, source_alias_map, display=False)
        from_clause = self._build_from(view, source_alias_map, ref_mode)
        join_clause = self._build_joins(view, source_alias_map, ref_mode)
        where_clause = self._build_where(view, source_alias_map)

        parts = [select_clause]
        if from_clause:
            parts.append(from_clause)
        if join_clause:
            parts.append(join_clause)
        if where_clause:
            parts.append(where_clause)

        return "\n".join(parts)

    def generate_display(self, view: View) -> str:
        """Generate display SQL (human-readable, with display types in CASTs).

        Returns SQL prefixed with a comment indicating it's for reference only.
        """
        source_alias_map = self._build_source_alias_map(view)
        select_clause = self._build_select(view, source_alias_map, display=True)
        from_clause = self._build_from(view, source_alias_map, ref_mode=False)
        join_clause = self._build_joins(view, source_alias_map, ref_mode=False)
        where_clause = self._build_where(view, source_alias_map)

        parts = ["-- SQL Preview \u2014 for reference only"]
        parts.append(select_clause)
        if from_clause:
            parts.append(from_clause)
        if join_clause:
            parts.append(join_clause)
        if where_clause:
            parts.append(where_clause)

        return "\n".join(parts)

    def _build_source_alias_map(self, view: View) -> dict[str, str]:
        """Map source_ref IDs to table aliases (s0, s1, ...)."""
        alias_map: dict[str, str] = {}
        for ref in view.source_refs:
            ref_id = ref["id"]
            if ref_id not in alias_map:
                alias_map[ref_id] = f"s{len(alias_map)}"
        return alias_map

    def _resolve_source(self, source_ref: str, view: View, ref_mode: bool) -> str:
        """Resolve a source_ref ID to a table name or dbt ref() call."""
        if not ref_mode:
            # Find the name from source_refs
            for ref in view.source_refs:
                if ref["id"] == source_ref:
                    return ref.get("name", source_ref)
            return source_ref

        # ref_mode: use dbt ref() macros
        for ref in view.source_refs:
            if ref["id"] == source_ref:
                ref_type = ref.get("type", "dataset")
                name = ref.get("name", source_ref)
                # Convert name to snake_case for dbt
                snake_name = name.lower().replace(" ", "_")
                if ref_type == "view":
                    return "{{ ref('int_" + snake_name + "') }}"
                else:
                    return "{{ ref('stg_" + snake_name + "') }}"
        return source_ref

    def _build_select(self, view: View, alias_map: dict[str, str], display: bool) -> str:
        """Build the SELECT clause."""
        if not view.columns:
            return "SELECT *"

        parts = []
        for col in view.columns:
            alias = alias_map.get(col.source_ref, "s0")
            cast_type = col.display_type.value if display else self.BACKEND_TYPE_MAP.get(col.display_type.value, "TEXT")
            output_name = col.alias if col.alias else col.source_column
            parts.append(f'  CAST({alias}."{col.source_column}" AS {cast_type}) AS "{output_name}"')

        return "SELECT\n" + ",\n".join(parts)

    def _build_from(self, view: View, alias_map: dict[str, str], ref_mode: bool) -> str:
        """Build the FROM clause using the primary source."""
        if not view.source_refs:
            return ""
        primary_ref = view.source_refs[0]
        primary_id = primary_ref["id"]
        primary_alias = alias_map[primary_id]
        source_name = self._resolve_source(primary_id, view, ref_mode)
        return f"FROM {source_name} AS {primary_alias}"

    def _build_joins(self, view: View, alias_map: dict[str, str], ref_mode: bool) -> str:
        """Build JOIN clauses."""
        if not view.joins:
            return ""
        parts = []
        for join in view.joins:
            left_alias = alias_map.get(join.left_ref, "s0")
            right_alias = alias_map.get(join.right_ref, "s1")
            right_source = self._resolve_source(join.right_ref, view, ref_mode)
            join_type = join.join_type.upper()
            parts.append(
                f"{join_type} JOIN {right_source} AS {right_alias} "
                f'ON {left_alias}."{join.left_column}" = {right_alias}."{join.right_column}"'
            )
        return "\n".join(parts)

    def _build_where(self, view: View, alias_map: dict[str, str]) -> str:
        """Build WHERE clause from filters."""
        if not view.filters:
            return ""
        conditions = []
        for f in view.filters:
            alias = alias_map.get(f.source_ref, "s0")
            col_ref = f'{alias}."{f.column}"'
            op = f.operator.upper()
            if op in ("IS NULL", "IS NOT NULL"):
                conditions.append(f"{col_ref} {op}")
            elif op in ("IN", "NOT IN"):
                conditions.append(f"{col_ref} {op} ({f.value})")
            else:
                conditions.append(f"{col_ref} {op} '{f.value}'")
        return "WHERE " + "\n  AND ".join(conditions)
