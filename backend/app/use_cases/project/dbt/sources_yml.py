from __future__ import annotations

from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from app.models.dataset import Dataset


def generate_sources_yml(
    project_name_snake: str, datasets: list[tuple[str, Dataset]]
) -> str:
    """Generate sources.yml from project name and dataset tuples.

    Each source table includes an external_location in meta so dbt-duckdb
    can resolve {{ source() }} references to S3 parquet paths.
    The S3 bucket is parameterized via dbt's env_var() Jinja macro.
    """
    tables = []
    for snake_name, dataset in datasets:
        tables.append(
            {
                "name": snake_name,
                "description": f"Source table: {dataset.name}",
                "meta": {
                    "external_location": (
                        "s3://{{ env_var('S3_BUCKET') }}/"
                        + dataset.storage_path
                        + "**/*.parquet"
                    ),
                    "dataset_id": dataset.id,
                },
            }
        )

    config = {
        "version": 2,
        "sources": [
            {
                "name": project_name_snake,
                "tables": tables,
            }
        ],
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
