from __future__ import annotations

from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from app.models.dataset import Dataset

_TYPE_MAP = {
    "text": "string",
    "number": "float64",
    "boolean": "boolean",
    "select": "string",
}


def generate_schema_yml(datasets: list[tuple[str, Dataset]]) -> str:
    """Generate schema.yml with model definitions."""
    models = []
    for snake_name, dataset in datasets:
        fields = dataset.schema_config.get("fields", {}) if dataset.schema_config else {}
        columns = [
            {
                "name": col_name,
                "data_type": _TYPE_MAP.get(col_info.get("type", "text"), "string"),
            }
            for col_name, col_info in fields.items()
        ]
        models.append(
            {
                "name": f"stg_{snake_name}",
                "columns": columns,
            }
        )

    config = {
        "version": 2,
        "models": models,
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
