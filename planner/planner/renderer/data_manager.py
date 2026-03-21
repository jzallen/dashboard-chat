"""Register data sources with Vizro's data manager."""

from __future__ import annotations

import asyncio

import pandas as pd
from vizro.managers import data_manager

from planner.data.types import SemanticQuery
from planner.data.warehouse import WarehouseRepository
from planner.schema.manifest import SemanticManifest


def register_data_sources(
    warehouse: WarehouseRepository, manifest: SemanticManifest
) -> None:
    """Register each manifest data source as a Vizro data manager function."""
    metric_ids = {m.id for m in manifest.metrics}

    for ds in manifest.data_sources:
        ds_id = ds.id
        col_ids = [col.id for col in ds.columns]

        def make_loader(source_id: str, columns: list[str]):
            def load_data():
                metrics = [c for c in columns if c in metric_ids]
                group_by = [c for c in columns if c not in metric_ids]
                query = SemanticQuery(
                    metrics=metrics,
                    group_by=group_by,
                )
                loop = asyncio.new_event_loop()
                try:
                    result = loop.run_until_complete(warehouse.query(query))
                finally:
                    loop.close()
                return pd.DataFrame(result.rows)

            return load_data

        data_manager[ds_id] = make_loader(ds_id, col_ids)
