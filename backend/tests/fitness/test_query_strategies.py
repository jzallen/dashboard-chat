"""Query optimization strategy benchmarks.

Compares baseline queries against three optimization strategies:
1. Projection — select only needed columns, skip heavy JSON blobs
2. Joinedload — single JOIN query vs multiple selectinload queries
3. FK indexes — add indexes on datasets.project_id and transforms.dataset_id

Each test runs the baseline and optimized variant side-by-side for direct comparison.

Run with: cd backend && uv run pytest tests/fitness/ -s -n0
"""

import json
import time
from contextlib import contextmanager
from unittest.mock import PropertyMock, patch

import pytest
from sqlalchemy import Index, select, text
from sqlalchemy.orm import joinedload, load_only, selectinload

from app.models.dataset import Dataset
from app.repositories.metadata.dataset_record import DatasetRecord
from app.repositories.metadata.project_record import ProjectRecord
from app.repositories.metadata.transform_record import TransformRecord


@contextmanager
def timed(label: str, results: dict):
    """Context manager that records elapsed time for a phase."""
    start = time.perf_counter()
    yield
    elapsed_ms = (time.perf_counter() - start) * 1000
    results[label] = elapsed_ms


def print_comparison_table(test_name: str, baseline: dict, optimized: dict):
    """Print a side-by-side comparison of baseline vs optimized timings."""
    baseline_total = sum(baseline.values())
    optimized_total = sum(optimized.values())
    speedup = baseline_total / optimized_total if optimized_total > 0 else float("inf")

    print(f"\n{'=' * 60}")
    print(f"  {test_name}")
    print(f"{'=' * 60}")
    print(f"  {'Phase':<30} {'Baseline':>10} {'Optimized':>10}")
    print(f"  {'-' * 52}")

    all_phases = list(dict.fromkeys(list(baseline.keys()) + list(optimized.keys())))
    for phase in all_phases:
        b = baseline.get(phase, 0)
        o = optimized.get(phase, 0)
        print(f"  {phase:<30} {b:>9.3f}ms {o:>9.3f}ms")

    print(f"  {'-' * 52}")
    print(f"  {'TOTAL':<30} {baseline_total:>9.3f}ms {optimized_total:>9.3f}ms")
    print(f"  Speedup: {speedup:.2f}x")
    print(f"{'=' * 60}\n")


# ---------------------------------------------------------------------------
# Strategy 1: Projection — load only the columns we need
# ---------------------------------------------------------------------------


@pytest.mark.fitness
async def test_projection_list_projects(seeded_fitness_db):
    """Compare full-column load vs projected (minimal columns) for list_projects.

    The list_projects endpoint only needs id, name, description from datasets —
    not schema_config or column_profiles (the heaviest JSON blobs).
    """
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    # --- Baseline: full column load (current behavior) ---
    with timed("query", baseline):
        query = (
            select(ProjectRecord)
            .options(selectinload(ProjectRecord.datasets))
            .order_by(ProjectRecord.created_at.desc())
        )
        result = await session.execute(query)
        projects_full = result.scalars().all()

    with timed("conversion + json", baseline):
        dicts_full = [
            {
                "id": p.id,
                "name": p.name,
                "datasets": [
                    {
                        "id": ds.id,
                        "name": ds.name,
                        "description": ds.description,
                        "schema_config": ds.schema_config,
                    }
                    for ds in p.datasets
                ],
            }
            for p in projects_full
        ]
        json.dumps(dicts_full)

    # Expire all to force fresh loads
    for p in projects_full:
        session.expire(p)

    # --- Optimized: projected dataset columns (skip schema_config, column_profiles) ---
    with timed("query", optimized):
        query = (
            select(ProjectRecord)
            .options(
                selectinload(ProjectRecord.datasets).load_only(
                    DatasetRecord.id,
                    DatasetRecord.name,
                    DatasetRecord.description,
                    DatasetRecord.project_id,
                )
            )
            .order_by(ProjectRecord.created_at.desc())
        )
        result = await session.execute(query)
        projects_proj = result.scalars().all()

    with timed("conversion + json", optimized):
        dicts_proj = [
            {
                "id": p.id,
                "name": p.name,
                "datasets": [
                    {
                        "id": ds.id,
                        "name": ds.name,
                        "description": ds.description,
                    }
                    for ds in p.datasets
                ],
            }
            for p in projects_proj
        ]
        json.dumps(dicts_proj)

    print_comparison_table("Projection: list_projects", baseline, optimized)

    # Both produce same project count
    assert len(dicts_full) == len(dicts_proj) == 5


@pytest.mark.fitness
async def test_projection_list_datasets(seeded_fitness_db):
    """Compare full-column load vs projected for list_datasets.

    When listing datasets, we don't need full transform bodies (condition_json,
    expression_config) — just metadata for display.
    """
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    project = (
        await session.execute(select(ProjectRecord).order_by(ProjectRecord.created_at).limit(1))
    ).scalar_one()

    # --- Baseline: full transform load ---
    with timed("query", baseline):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(selectinload(DatasetRecord.transforms))
        )
        result = await session.execute(query)
        records_full = result.scalars().all()

    with timed("from_record + serialize", baseline):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            datasets_full = [Dataset.from_record(r) for r in records_full]
            json.dumps([ds.serialize() for ds in datasets_full])

    for r in records_full:
        session.expire(r)

    # --- Optimized: projected transform columns (skip heavy JSON) ---
    with timed("query", optimized):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(
                selectinload(DatasetRecord.transforms).load_only(
                    TransformRecord.id,
                    TransformRecord.name,
                    TransformRecord.status,
                    TransformRecord.transform_type,
                    TransformRecord.dataset_id,
                )
            )
        )
        result = await session.execute(query)
        records_proj = result.scalars().all()

    with timed("lightweight serialize", optimized):
        dicts_proj = [
            {
                "id": r.id,
                "name": r.name,
                "transforms": [
                    {"id": t.id, "name": t.name, "status": t.status, "type": t.transform_type}
                    for t in r.transforms
                ],
            }
            for r in records_proj
        ]
        json.dumps(dicts_proj)

    print_comparison_table("Projection: list_datasets", baseline, optimized)

    assert len(records_full) == len(records_proj) == 4


# ---------------------------------------------------------------------------
# Strategy 2: Joinedload — single query vs selectinload (multiple queries)
# ---------------------------------------------------------------------------


@pytest.mark.fitness
async def test_joinedload_get_dataset(seeded_fitness_db):
    """Compare selectinload (3 queries) vs joinedload (1 query) for get_dataset.

    selectinload issues: 1 SELECT datasets + 1 SELECT projects + 1 SELECT transforms
    joinedload issues:   1 SELECT with LEFT JOINs
    """
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    dataset_id = (await session.execute(select(DatasetRecord).limit(1))).scalar_one().id

    # --- Baseline: selectinload (current behavior — 3 queries) ---
    with timed("query (selectinload)", baseline):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.id == dataset_id)
            .options(
                selectinload(DatasetRecord.project),
                selectinload(DatasetRecord.transforms),
            )
        )
        result = await session.execute(query)
        record_sel = result.scalar_one()

    with timed("from_record + serialize", baseline):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            ds_sel = Dataset.from_record(record_sel)
            json.dumps(ds_sel.serialize())

    session.expire(record_sel)

    # --- Optimized: joinedload (1 query with JOINs) ---
    with timed("query (joinedload)", optimized):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.id == dataset_id)
            .options(
                joinedload(DatasetRecord.project),
                joinedload(DatasetRecord.transforms),
            )
        )
        result = await session.execute(query)
        record_join = result.unique().scalar_one()

    with timed("from_record + serialize", optimized):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            ds_join = Dataset.from_record(record_join)
            json.dumps(ds_join.serialize())

    print_comparison_table("Joinedload: get_dataset", baseline, optimized)

    # Both produce identical domain objects
    assert ds_sel.id == ds_join.id
    assert len(ds_sel.transforms) == len(ds_join.transforms) == 3


@pytest.mark.fitness
async def test_joinedload_list_projects(seeded_fitness_db):
    """Compare selectinload vs joinedload for list_projects with sparse datasets."""
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    # --- Baseline: selectinload ---
    with timed("query (selectinload)", baseline):
        query = (
            select(ProjectRecord)
            .options(selectinload(ProjectRecord.datasets))
            .order_by(ProjectRecord.created_at.desc())
        )
        result = await session.execute(query)
        projects_sel = result.scalars().all()

    with timed("dict conversion", baseline):
        json.dumps([{"id": p.id, "datasets": len(p.datasets)} for p in projects_sel])

    for p in projects_sel:
        session.expire(p)

    # --- Optimized: joinedload ---
    with timed("query (joinedload)", optimized):
        query = (
            select(ProjectRecord)
            .options(joinedload(ProjectRecord.datasets))
            .order_by(ProjectRecord.created_at.desc())
        )
        result = await session.execute(query)
        projects_join = result.unique().scalars().all()

    with timed("dict conversion", optimized):
        json.dumps([{"id": p.id, "datasets": len(p.datasets)} for p in projects_join])

    print_comparison_table("Joinedload: list_projects", baseline, optimized)

    assert len(projects_sel) == len(projects_join) == 5


# ---------------------------------------------------------------------------
# Strategy 3: FK Indexes — add indexes on relationship columns
# ---------------------------------------------------------------------------


@pytest.mark.fitness
async def test_fk_indexes_list_datasets(seeded_fitness_db):
    """Compare query performance before and after adding FK indexes.

    Currently missing:
    - datasets.project_id (no index — used in every project->datasets load)
    - transforms.dataset_id (no index — used in every dataset->transforms load)

    This test creates the indexes at runtime and measures the difference.
    """
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    project = (
        await session.execute(select(ProjectRecord).order_by(ProjectRecord.created_at).limit(1))
    ).scalar_one()

    # --- Baseline: without FK indexes (current state) ---
    with timed("query (no FK indexes)", baseline):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(selectinload(DatasetRecord.transforms))
        )
        result = await session.execute(query)
        records_before = result.scalars().all()

    with timed("from_record + serialize", baseline):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            datasets_before = [Dataset.from_record(r) for r in records_before]
            json.dumps([ds.serialize() for ds in datasets_before])

    # --- Create FK indexes ---
    conn = await session.connection()
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasets_project_id ON datasets (project_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transforms_dataset_id ON transforms (dataset_id)"))

    # Expire cached objects to force fresh loads
    for r in records_before:
        session.expire(r)

    # --- Optimized: with FK indexes ---
    with timed("query (with FK indexes)", optimized):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(selectinload(DatasetRecord.transforms))
        )
        result = await session.execute(query)
        records_after = result.scalars().all()

    with timed("from_record + serialize", optimized):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            datasets_after = [Dataset.from_record(r) for r in records_after]
            json.dumps([ds.serialize() for ds in datasets_after])

    print_comparison_table("FK Indexes: list_datasets", baseline, optimized)

    assert len(datasets_before) == len(datasets_after) == 4
    for ds in datasets_after:
        assert len(ds.transforms) == 3


@pytest.mark.fitness
async def test_fk_indexes_get_dataset(seeded_fitness_db):
    """Compare single-record fetch before and after FK indexes."""
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    dataset_id = (await session.execute(select(DatasetRecord).limit(1))).scalar_one().id

    # --- Baseline: without FK indexes ---
    with timed("query (no FK indexes)", baseline):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.id == dataset_id)
            .options(
                selectinload(DatasetRecord.project),
                selectinload(DatasetRecord.transforms),
            )
        )
        result = await session.execute(query)
        record_before = result.scalar_one()

    with timed("from_record + serialize", baseline):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            ds_before = Dataset.from_record(record_before)
            json.dumps(ds_before.serialize())

    # --- Create FK indexes ---
    conn = await session.connection()
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasets_project_id ON datasets (project_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transforms_dataset_id ON transforms (dataset_id)"))

    session.expire(record_before)

    # --- Optimized: with FK indexes ---
    with timed("query (with FK indexes)", optimized):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.id == dataset_id)
            .options(
                selectinload(DatasetRecord.project),
                selectinload(DatasetRecord.transforms),
            )
        )
        result = await session.execute(query)
        record_after = result.scalar_one()

    with timed("from_record + serialize", optimized):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            ds_after = Dataset.from_record(record_after)
            json.dumps(ds_after.serialize())

    print_comparison_table("FK Indexes: get_dataset", baseline, optimized)

    assert ds_before.id == ds_after.id == dataset_id


# ---------------------------------------------------------------------------
# Combined: All three strategies together
# ---------------------------------------------------------------------------


@pytest.mark.fitness
async def test_combined_optimizations_list_datasets(seeded_fitness_db):
    """Apply all three strategies together: FK indexes + joinedload + projection.

    This shows the maximum achievable speedup from query-level optimizations alone.
    """
    session = seeded_fitness_db
    baseline = {}
    optimized = {}

    project = (
        await session.execute(select(ProjectRecord).order_by(ProjectRecord.created_at).limit(1))
    ).scalar_one()

    # --- Baseline: current implementation (no indexes, selectinload, full columns) ---
    with timed("query", baseline):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(selectinload(DatasetRecord.transforms))
        )
        result = await session.execute(query)
        records_base = result.scalars().all()

    with timed("from_record + serialize", baseline):
        with patch.object(Dataset, "display_sql", new_callable=PropertyMock, return_value="SELECT *"):
            datasets_base = [Dataset.from_record(r) for r in records_base]
            payload_base = json.dumps([ds.serialize() for ds in datasets_base])

    # --- Create FK indexes ---
    conn = await session.connection()
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasets_project_id ON datasets (project_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transforms_dataset_id ON transforms (dataset_id)"))

    for r in records_base:
        session.expire(r)

    # --- Optimized: FK indexes + joinedload + projection ---
    with timed("query", optimized):
        query = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project.id)
            .options(
                joinedload(DatasetRecord.transforms).load_only(
                    TransformRecord.id,
                    TransformRecord.name,
                    TransformRecord.status,
                    TransformRecord.transform_type,
                    TransformRecord.target_column,
                    TransformRecord.dataset_id,
                )
            )
            .options(
                load_only(
                    DatasetRecord.id,
                    DatasetRecord.name,
                    DatasetRecord.description,
                    DatasetRecord.project_id,
                    DatasetRecord.schema_config,
                )
            )
        )
        result = await session.execute(query)
        records_opt = result.unique().scalars().all()

    with timed("lightweight serialize", optimized):
        dicts_opt = [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "schema_config": r.schema_config,
                "transforms": [
                    {"id": t.id, "name": t.name, "status": t.status, "type": t.transform_type}
                    for t in r.transforms
                ],
            }
            for r in records_opt
        ]
        payload_opt = json.dumps(dicts_opt)

    print_comparison_table("Combined: list_datasets (all strategies)", baseline, optimized)

    assert len(records_base) == len(records_opt) == 4
    assert len(payload_base) > 0
    assert len(payload_opt) > 0
