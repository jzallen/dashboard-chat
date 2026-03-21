"""Hardcoded warehouse returning synthetic data based on manifest field types."""

from __future__ import annotations

import random
from datetime import date, timedelta

from planner.data.types import ColumnMetadata, SemanticQuery, SemanticQueryResult
from planner.data.warehouse import WarehouseRepository
from planner.schema.manifest import SemanticManifest

_SAMPLE_STRINGS = {
    "department": ["Cardiology", "Neurology", "Orthopedics", "Oncology", "Pediatrics"],
    "gender": ["Male", "Female", "Other"],
    "discharge_disposition": ["Home", "SNF", "Rehab", "Expired", "AMA"],
    "_default": ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"],
}


class HardcodedWarehouseRepository(WarehouseRepository):
    def __init__(self, manifest: SemanticManifest) -> None:
        self._manifest = manifest
        self._metrics_by_id = {m.id: m for m in manifest.metrics}
        self._dims_by_id = {d.id: d for d in manifest.dimensions}
        self._cols_by_id = {}
        for ds in manifest.data_sources:
            for col in ds.columns:
                self._cols_by_id[col.id] = col

    async def query(self, query: SemanticQuery) -> SemanticQueryResult:
        columns: list[ColumnMetadata] = []
        for dim_id in query.group_by:
            dim = self._dims_by_id.get(dim_id)
            col_type = "time_dimension" if dim and dim.type == "time" else "dimension"
            data_type = "date" if col_type == "time_dimension" else "string"
            columns.append(ColumnMetadata(name=dim_id, type=col_type, data_type=data_type))

        for metric_id in query.metrics:
            columns.append(ColumnMetadata(name=metric_id, type="metric", data_type="number"))

        num_rows = query.limit or 10
        rows = []
        for i in range(num_rows):
            row = {}
            for dim_id in query.group_by:
                dim = self._dims_by_id.get(dim_id)
                if dim and dim.type == "time":
                    row[dim_id] = (date(2024, 1, 1) + timedelta(days=30 * i)).isoformat()
                else:
                    values = _SAMPLE_STRINGS.get(dim_id, _SAMPLE_STRINGS["_default"])
                    row[dim_id] = values[i % len(values)]
            for metric_id in query.metrics:
                row[metric_id] = round(random.uniform(10, 1000), 2)
            rows.append(row)

        return SemanticQueryResult(columns=columns, rows=rows)

    async def list_dimension_values(self, dimension_id: str, limit: int = 100) -> list[str]:
        values = _SAMPLE_STRINGS.get(dimension_id, _SAMPLE_STRINGS["_default"])
        return values[:limit]
