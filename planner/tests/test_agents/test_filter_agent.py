"""Tests for the filter agent with mock LLM."""

from unittest.mock import AsyncMock, patch

import pytest

from planner.agents.filter_agent import FilterOutput, filter_node
from planner.schema.plan import FilterSpec


@pytest.fixture
def mock_filter_output():
    return FilterOutput(
        filters=[
            FilterSpec(dimension_id="department", widget_type="dropdown", label="Department"),
            FilterSpec(dimension_id="gender", widget_type="checklist", label="Gender"),
            FilterSpec(
                dimension_id="admission_month", widget_type="date_picker", label="Period"
            ),
        ]
    )


class TestFilterAgent:
    async def test_produces_filter_specs(
        self, sample_manifest, mock_settings, mock_filter_output
    ):
        mock_llm = AsyncMock(return_value=mock_filter_output)

        with patch("planner.agents.filter_agent.ChatAnthropic") as MockChat:
            instance = MockChat.return_value
            instance.with_structured_output.return_value.ainvoke = mock_llm

            state = {
                "user_prompt": "Build a patient dashboard",
                "manifest": sample_manifest,
                "section_plan": {
                    "sections": [
                        {"title": "Key Metrics"},
                        {"title": "Trends"},
                    ]
                },
            }

            result = await filter_node(state)

        assert "filter_results" in result
        filters = result["filter_results"]["filters"]
        assert len(filters) == 3

    async def test_filter_widget_types(
        self, sample_manifest, mock_settings, mock_filter_output
    ):
        mock_llm = AsyncMock(return_value=mock_filter_output)

        with patch("planner.agents.filter_agent.ChatAnthropic") as MockChat:
            instance = MockChat.return_value
            instance.with_structured_output.return_value.ainvoke = mock_llm

            state = {
                "user_prompt": "Patient dashboard",
                "manifest": sample_manifest,
                "section_plan": {"sections": []},
            }

            result = await filter_node(state)

        filters = result["filter_results"]["filters"]
        widget_types = {f["widget_type"] for f in filters}
        assert "dropdown" in widget_types
        assert "date_picker" in widget_types
