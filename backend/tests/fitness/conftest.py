"""Fixtures for serialization fitness benchmarks."""

from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata.dataset_record import DatasetRecord
from app.repositories.metadata.project_record import ProjectRecord
from app.repositories.metadata.transform_record import TransformRecord

# Use e-segment prefix to avoid collision with uuidv7_fixtures.py
ORG_1 = "019515a0-4001-7000-8000-000000000041"
USER_1 = "019515a0-3001-7000-8000-000000000031"

# Deterministic IDs with e-segment prefix
_PROJECT_IDS = [f"019515a0-e{i:03x}-7000-8000-{i:012x}" for i in range(1, 6)]
_DATASET_IDS = [f"019515a0-e{i:03x}-7000-8000-{i:012x}" for i in range(101, 121)]
_TRANSFORM_IDS = [f"019515a0-e{i:03x}-7000-8000-{i:012x}" for i in range(201, 261)]


def _make_schema_config() -> dict:
    """Generate a realistic 10-field schema_config."""
    fields = {}
    for i in range(10):
        col_type = ["text", "number", "boolean", "select"][i % 4]
        fields[f"col_{i}"] = {
            "type": col_type,
            "label": f"Column {i}",
            "validators": {"required": i < 3},
        }
    return {"fields": fields}


def _make_column_profiles() -> dict:
    """Generate realistic column_profiles for 10 columns."""
    profiles = {}
    for i in range(10):
        profiles[f"col_{i}"] = {
            "type": ["text", "number", "boolean", "select"][i % 4],
            "unique_count": 50 + i * 10,
            "null_count": i,
            "sample_values": [f"val_{j}" for j in range(5)],
        }
    return profiles


def _make_condition_json(variant: int) -> dict:
    """Generate realistic RAQB condition_json."""
    return {
        "id": f"rule-{variant}",
        "type": "group",
        "children1": {
            f"child-{variant}": {
                "type": "rule",
                "properties": {
                    "field": f"col_{variant % 10}",
                    "operator": "equal",
                    "value": [f"filter_val_{variant}"],
                    "valueSrc": ["value"],
                    "valueType": ["text"],
                },
            }
        },
        "properties": {"conjunction": "AND"},
    }


def _make_expression_config(transform_type: str, variant: int) -> dict | None:
    """Generate realistic expression_config for clean/alias types."""
    if transform_type == "clean":
        return {
            "operation": "trim",
            "target_column": f"col_{variant % 10}",
            "params": {"side": "both"},
        }
    if transform_type == "alias":
        return {
            "operation": "rename",
            "target_column": f"col_{variant % 10}",
            "alias_name": f"renamed_col_{variant}",
        }
    return None


@pytest.fixture(autouse=True)
def auth_context():
    """Set auth user for all fitness tests."""
    set_auth_user(AuthUser(id=USER_1, email="fitness@test.com", org_id=ORG_1))
    yield
    clear_auth_user()


@pytest.fixture
async def seeded_fitness_db(db_session: AsyncSession):
    """Seed realistic data: 5 projects, 20 datasets, 60 transforms."""
    now = datetime.now(UTC)
    transform_idx = 0

    for p_idx, project_id in enumerate(_PROJECT_IDS):
        project = ProjectRecord(
            id=project_id,
            name=f"Fitness Project {p_idx + 1}",
            description=f"Test project {p_idx + 1} for fitness benchmarks",
            org_id=ORG_1,
            created_by=USER_1,
            created_at=now,
            updated_at=now,
        )
        db_session.add(project)

        # 4 datasets per project
        for d_offset in range(4):
            d_idx = p_idx * 4 + d_offset
            dataset_id = _DATASET_IDS[d_idx]
            dataset = DatasetRecord(
                id=dataset_id,
                project_id=project_id,
                name=f"Dataset {d_idx + 1}",
                description=f"Test dataset {d_idx + 1}",
                schema_config=_make_schema_config(),
                partition_fields=["col_0"],
                column_profiles=_make_column_profiles(),
                created_at=now,
                updated_at=now,
            )
            db_session.add(dataset)

            # 3 transforms per dataset: filter, clean, alias
            for t_offset, t_type in enumerate(["filter", "clean", "alias"]):
                t_id = _TRANSFORM_IDS[transform_idx]
                variant = transform_idx

                transform = TransformRecord(
                    id=t_id,
                    dataset_id=dataset_id,
                    name=f"Transform {variant + 1} ({t_type})",
                    description=f"Test {t_type} transform",
                    condition_json=_make_condition_json(variant) if t_type == "filter" else {},
                    condition_sql=f"col_{variant % 10} = 'filter_val_{variant}'" if t_type == "filter" else None,
                    version=1,
                    status="enabled",
                    transform_type=t_type,
                    target_column=f"col_{variant % 10}" if t_type != "filter" else None,
                    expression_sql=f"TRIM(col_{variant % 10})" if t_type == "clean" else None,
                    expression_config=_make_expression_config(t_type, variant),
                    created_at=now,
                    updated_at=now,
                )
                db_session.add(transform)
                transform_idx += 1

    await db_session.flush()
    yield db_session
