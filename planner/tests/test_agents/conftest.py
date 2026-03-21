"""Shared fixtures for agent tests."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def sample_manifest():
    return json.loads((FIXTURES_DIR / "sample_manifest.json").read_text())


@pytest.fixture
def sample_dashboard_plan():
    return json.loads((FIXTURES_DIR / "sample_dashboard_plan.json").read_text())


@pytest.fixture
def mock_settings():
    """Mock settings with no API key (disables LLM calls in validation)."""
    with patch("planner.config.get_settings") as mock:
        settings = MagicMock()
        settings.model = "claude-sonnet-4-6"
        settings.temperature = 0.1
        settings.anthropic_api_key = ""
        mock.return_value = settings
        yield settings
