import re


def to_snake_case(name: str) -> str:
    """Convert a name to snake_case for dbt identifiers."""
    safe = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return safe or "dataset"


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
