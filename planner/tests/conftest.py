import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_manifest_path():
    return FIXTURES_DIR / "sample_manifest.json"


@pytest.fixture
def sample_manifest(sample_manifest_path):
    return json.loads(sample_manifest_path.read_text())


@pytest.fixture
def sample_dashboard_plan_path():
    return FIXTURES_DIR / "sample_dashboard_plan.json"


@pytest.fixture
def sample_dashboard_plan(sample_dashboard_plan_path):
    return json.loads(sample_dashboard_plan_path.read_text())
