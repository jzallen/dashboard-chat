"""Serialization fitness benchmarks.

Measures the real read pipeline end-to-end:
SQLite query -> ORM hydration -> domain model conversion -> JSON serialization.

Run with: cd backend && uv run pytest tests/fitness/ -s -n0
"""

import json
import time
from contextlib import contextmanager
from unittest.mock import PropertyMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.repositories.metadata.dataset_record import DatasetRecord
from app.repositories.metadata.project_record import ProjectRecord

@contextmanager
def timed(label: str, results: dict):
    """Context manager that records elapsed time for a phase."""
    start = time.perf_counter()
    yield
    elapsed_ms = (time.perf_counter() - start) * 1000
    results[label] = elapsed_ms


def print_timing_table(test_name: str, results: dict):
    """Print a formatted timing table (visible with -s flag)."""
    total = sum(results.values())
    header = f"{'Phase':<30} {'Time (ms)':>12}"
    separator = "-" * 43
    rows = "\n".join(f"{phase:<30} {ms:>12.3f}" for phase, ms in results.items())
    footer = f"{'TOTAL':<30} {total:>12.3f}"
    print(f"\n{test_name}\n{header}\n{separator}\n{rows}\n{separator}\n{footer}\n")


@pytest.mark.fitness
async def test_list_projects_serialization(seeded_fitness_db):
    """Benchmark: list_projects query -> dict conversion -> JSON."""
    session = seeded_fitness_db
    timings = {}

    # Phase 1: Query
    with timed("query (selectinload datasets)", timings):
        query = (
            select(ProjectRecord)
            .options(selectinload(ProjectRecord.datasets))
            .order_by(ProjectRecord.created_at.desc())
        )
        result = await session.execute(query)
        projects = result.scalars().all()

    # Phase 2: Convert to dicts (mirrors MetadataRepository.list_projects)
    with timed("dict conversion", timings):
        project_dicts = [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "org_id": p.org_id,
                "created_by": p.created_by,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                "datasets": [
                    {
                        "id": ds.id,
                        "name": ds.name,
                        "link": f"/api/datasets/{ds.id}",
                        "description": ds.description,
                        "schema_config": ds.schema_config,
                    }
                    for ds in p.datasets
                ],
            }
            for p in projects
        ]

    # Phase 3: JSON serialization
    with timed("json.dumps", timings):
        payload = json.dumps(project_dicts)

    print_timing_table("test_list_projects_serialization", timings)

    # Assertions
    assert len(project_dicts) == 5
    for p in project_dicts:
        assert len(p["datasets"]) == 4
    assert len(payload) > 0


@pytest.mark.fitness
async def test_list_datasets_serialization(seeded_fitness_db):
    """Benchmark: list_datasets query -> Dataset.from_record -> serialize -> JSON."""
    session = seeded_fitness_db
    timings = {}

    # Pick first project's datasets
    first_project_query = select(ProjectRecord).order_by(ProjectRecord.created_at).limit(1)
    project = (await session.execute(first_project_query)).scalar_one()

    # Phase 1: Query
    with timed("query (selectinload transforms)", timings):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(selectinload(DatasetRecord.transforms))
        )
        result = await session.execute(query)
        records = result.scalars().all()

    # Phase 2: Domain model conversion
    with timed("Dataset.from_record (x4)", timings):
        datasets = [Dataset.from_record(r) for r in records]

    # Phase 3: Serialize + JSON (mock display_sql to avoid Ibis/DuckDB)
    with timed("serialize + json.dumps", timings):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT * FROM mock"):
            serialized = [ds.serialize() for ds in datasets]
            payload = json.dumps(serialized)

    print_timing_table("test_list_datasets_serialization", timings)

    # Assertions
    assert len(datasets) == 4
    for ds in datasets:
        assert len(ds.transforms) == 3
        assert all(isinstance(t, Transform) for t in ds.transforms)
    assert len(payload) > 0


@pytest.mark.fitness
async def test_get_dataset_serialization(seeded_fitness_db):
    """Benchmark: get_dataset single record -> Dataset.from_record -> serialize -> JSON."""
    session = seeded_fitness_db
    timings = {}

    # Get a known dataset ID
    first_dataset = (await session.execute(select(DatasetRecord).limit(1))).scalar_one()
    dataset_id = first_dataset.id

    # Phase 1: Query (with project + transforms eager load)
    with timed("query (single record)", timings):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.id == dataset_id)
            .options(selectinload(DatasetRecord.project), selectinload(DatasetRecord.transforms))
        )
        result = await session.execute(query)
        record = result.scalar_one()

    # Phase 2: Domain model conversion
    with timed("Dataset.from_record", timings):
        dataset = Dataset.from_record(record)

    # Phase 3: Serialize + JSON (mock display_sql)
    with timed("serialize + json.dumps", timings):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT * FROM mock"):
            serialized = dataset.serialize()
            payload = json.dumps(serialized)

    print_timing_table("test_get_dataset_serialization", timings)

    # Assertions
    assert serialized["id"] == dataset_id
    assert len(dataset.transforms) == 3
    assert "staging_sql" in serialized
    assert len(payload) > 0
