import re
from typing import Any


def to_snake_case(name: str) -> str:
    """Convert a name to snake_case for dbt identifiers."""
    safe = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return safe or "dataset"


def resolved_view_name(dataset: Any) -> str:
    """Resolve the warehouse staging-view name a dataset exposes.

    Single source of truth for the FIVE derivation sites that name the live
    DuckDB staging view (sync processor, project delete, two SQL-access
    advertisers, and the dbt eject). A dataset's editable ``model_name``
    (e.g. ``stg_customers``) wins when set; otherwise we fall back to the
    legacy derivation ``to_snake_case(dataset.name)`` (e.g. ``customers``).

    The fallback deliberately matches the historical view name so legacy
    datasets (``model_name IS NULL``) keep the view they already have. A
    project-scoped uniqueness check at the update use-case layer guarantees
    a user-set ``model_name`` never collides with a sibling's resolved name.
    """
    model_name = getattr(dataset, "model_name", None)
    if model_name:
        return model_name
    return to_snake_case(dataset.name)


def resolved_view_names(datasets: list[Any]) -> list[str]:
    """Resolve a project's staging-view names, deduplicating the legacy fallback.

    A user-set ``model_name`` is used verbatim (the update use-case guarantees it
    is project-unique). Rows that still derive their name from the filename
    fallback are run through ``deduplicate_names`` so two same-named legacy
    datasets keep distinct ``_1`` suffixes — matching the historical behavior.

    Order is preserved 1:1 with ``datasets``.
    """
    fallback_snakes = iter(deduplicate_names([to_snake_case(ds.name) for ds in datasets]))
    resolved: list[str] = []
    for dataset in datasets:
        model_name = getattr(dataset, "model_name", None)
        fallback = next(fallback_snakes)
        resolved.append(model_name or fallback)
    return resolved


def deduplicate_names(names: list[str]) -> list[str]:
    """Ensure unique snake_case names by appending _1, _2 suffixes for collisions."""
    seen: dict[str, int] = {}
    result = []
    for name in names:
        snake = to_snake_case(name)
        if snake in seen:
            seen[snake] += 1
            result.append(f"{snake}_{seen[snake]}")
        else:
            seen[snake] = 0
            result.append(snake)
    return result
