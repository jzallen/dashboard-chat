"""Staging-tier dbt SQL compilation — thin orchestrator over the ibis pipeline.

Per ADR-026 §"Decision outcome" item 1 and the MR-5 row of §"MR roadmap",
``generate_model_sql`` is now a thin orchestrator that:

1. Filters ``dataset.transforms`` for enabled rows.
2. Returns a byte-faithful ``SELECT * FROM {{ source(...) }}`` passthrough
   when no enabled transforms remain (the dbt staging-tier passthrough
   contract).
3. Otherwise builds the ibis Table via :func:`app.models.dataset_sql.build_ibis_table`
   and renders it through
   :class:`app.use_cases.project._dbt.ibis_dbt_source.IbisDbtSourceDuckDBCompiler`
   which emits ``{{ source('<project>', '<dataset>') }}`` at the source-table
   position.

The retired per-operation CTE-emission helpers (``_fill_null_to_sql``,
``_map_values_to_sql``, ``_transform_to_sql``, ``_case_to_sql``, ``_is_numeric``,
``_build_cleaned_cte``, ``_build_alias_select``, ``_get_schema_columns``) were
the parallel SQL emission path ADR-026 retires. Their tests
(``test_model_sql.py``) interrogated the legacy CTE mechanism (``WITH source
AS`` / ``cleaned AS`` / ``filtered AS``); they are rewritten at L2
(contract-mirroring) per nw-test-refactoring-catalog so they pin the
dbt-staging-SQL contract — row-equivalence under DuckDB and the
``{{ source(...) }}`` macro position — rather than the legacy CTE byte shape.

DWD-4 (hard constraint): NO ``.replace("'", "''")`` defenses live here.
Ibis literal escaping IS the closure mechanism for SQL injection.

The single internal helper :func:`_normalize_alias_to_snake` pre-snake-cases
the alias names BEFORE they reach the ibis pipeline so the dbt staging
model's column headers stay snake-cased (the legacy contract). This is the
only dbt-export-specific normalization the orchestrator applies; everything
else delegates to ``app.models.dataset_sql``.
"""

from __future__ import annotations

import re
from dataclasses import replace
from typing import TYPE_CHECKING

from app.models import dataset_sql

from .ibis_dbt_source import IbisDbtSourceDuckDBCompiler

if TYPE_CHECKING:
    from app.models.dataset import Dataset
    from app.models.transform import Transform


def generate_model_sql(project_name_snake: str, dataset_name_snake: str, dataset: Dataset) -> str:
    """Generate dbt staging SQL for a dataset's transforms.

    Returns either:

    * The simple passthrough ``"SELECT * FROM {{ source(...) }}"`` when no
      enabled transforms remain (byte-faithful with the legacy compiler).
    * The ibis-rendered staging pipeline with the source macro at the FROM
      clause when transforms are present.

    The dbt-source macro is the customer-visible contract — staging models
    reference their upstream raw dataset via ``{{ source('<project>',
    '<dataset>') }}``.
    """
    enabled = [t for t in (dataset.transforms or []) if t.is_enabled]
    source_ref = f"{{{{ source('{project_name_snake}', '{dataset_name_snake}') }}}}"

    if not enabled:
        return f"SELECT * FROM {source_ref}"

    # Production filter transforms always carry condition_json (the metadata
    # DB column is NOT NULL); the new ibis path reads condition_json via
    # apply_filter_predicates in dataset_sql. Alias names are normalized to
    # snake_case here so the dbt staging model's column headers stay
    # snake-cased (the legacy contract).
    structured_transforms = [_normalize_alias_to_snake(t) for t in enabled]

    schema_config = dataset.schema_config or {}
    if not schema_config.get("fields"):
        # The legacy emit produced "<expr>, *" when no schema fields existed
        # — an undocumented escape hatch. The new contract requires
        # schema-present datasets; emit an error comment for visibility.
        return (
            "-- Error generating SQL: dataset has transforms but no "
            "schema_config.fields; cannot generate dbt staging SQL"
        )

    try:
        table = dataset_sql.build_ibis_table(
            dataset.name,
            schema_config,
            structured_transforms,
            table_name=dataset.name,
        )
        compiler = IbisDbtSourceDuckDBCompiler(
            project_snake=project_name_snake,
            dataset_snake=dataset_name_snake,
        )
        return compiler.render(table)
    except Exception as e:
        # The legacy compiler emitted a "-- unsupported operation: ..." comment
        # for unknown clean operations. The ibis pipeline rejects them at the
        # CleaningExpression validation gate; preserve the visible-error
        # contract by wrapping the failure in a SQL comment.
        return f"-- Error generating SQL: {e!s}"


def _normalize_alias_to_snake(transform: Transform) -> Transform:
    """Pre-snake-case the alias name before reaching the ibis pipeline.

    The dbt staging model contract: column headers are snake_case. The
    legacy compiler snake-cased the alias before emission; the ibis
    ``rename`` step preserves whatever string it receives, so the
    orchestrator snake-cases the alias upstream of the ibis call to keep
    the contract byte-faithful with the legacy emit.

    No-op for non-alias transforms.
    """
    if transform.transform_type != "alias" or not transform.expression_config:
        return transform

    config = dict(transform.expression_config)
    alias_name = config.get("alias") or config.get("alias_name", "")
    if not alias_name:
        return transform

    config["alias"] = re.sub(r"[^a-z0-9]+", "_", alias_name.lower()).strip("_")
    return replace(transform, expression_config=config)
