"""Tests for the validation agent."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from planner.agents.validation_agent import ValidationOutput, validate_plan_locally, validation_node
from planner.schema.manifest import SemanticManifest
from planner.schema.plan import DashboardPlan


class TestValidationLocal:
    def test_valid_plan_passes(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        errors = validate_plan_locally(plan, manifest)
        assert errors == []

    def test_invalid_metric_reference(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        # Inject an invalid metric reference
        sample_dashboard_plan["sections"][0]["components"][0]["spec"]["metric_id"] = "nonexistent"
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        errors = validate_plan_locally(plan, manifest)
        assert any("nonexistent" in e for e in errors)

    def test_invalid_dimension_in_filter(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        sample_dashboard_plan["filters"][0]["dimension_id"] = "bad_dim"
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        errors = validate_plan_locally(plan, manifest)
        assert any("bad_dim" in e for e in errors)

    def test_invalid_grid_index(self, sample_manifest):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(
            {
                "title": "Test",
                "sections": [
                    {
                        "id": "s1",
                        "title": "S",
                        "components": [
                            {
                                "id": "c1",
                                "type": "chart",
                                "spec": {
                                    "chart_type": "kpi_card",
                                    "title": "KPI",
                                    "metric_id": "patient_count",
                                },
                            }
                        ],
                        "grid": [[0, 5]],  # index 5 is out of range
                    }
                ],
            }
        )
        errors = validate_plan_locally(plan, manifest)
        assert any("grid index" in e.lower() or "out of range" in e.lower() for e in errors)

    def test_invalid_data_source(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        sample_dashboard_plan["data_source_ids"] = ["patients", "nonexistent_source"]
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        errors = validate_plan_locally(plan, manifest)
        assert any("nonexistent_source" in e for e in errors)


class TestValidationNode:
    @pytest.fixture
    def valid_state(self, sample_manifest, sample_dashboard_plan):
        return {
            "assembled_plan": sample_dashboard_plan,
            "manifest": sample_manifest,
        }

    async def test_validation_node_local_errors_short_circuit(self, sample_manifest, sample_dashboard_plan):
        """When local validation finds errors, LLM should not be called."""
        sample_dashboard_plan["filters"][0]["dimension_id"] = "bad_dim"
        state = {"assembled_plan": sample_dashboard_plan, "manifest": sample_manifest}

        with patch("planner.agents.validation_agent.ChatAnthropic") as mock_llm_cls:
            result = await validation_node(state)

        mock_llm_cls.assert_not_called()
        assert result["final_plan"] is None
        assert any("bad_dim" in e for e in result["validation_errors"])

    async def test_validation_node_llm_approves(self, valid_state):
        """When local validation passes and LLM approves, plan is accepted."""
        mock_structured = AsyncMock()
        mock_structured.ainvoke.return_value = ValidationOutput(approved=True, errors=[])

        with patch("planner.agents.validation_agent.get_settings") as mock_settings, \
             patch("planner.agents.validation_agent.ChatAnthropic") as mock_llm_cls:
            mock_settings.return_value.anthropic_api_key = "test-key"
            mock_settings.return_value.model = "claude-sonnet-4-6"
            mock_settings.return_value.temperature = 0.1
            mock_llm_cls.return_value.with_structured_output.return_value = mock_structured

            result = await validation_node(valid_state)

        assert result["final_plan"] == valid_state["assembled_plan"]
        assert result["validation_errors"] == []

    async def test_validation_node_llm_rejects(self, valid_state):
        """When local validation passes but LLM finds issues, plan is rejected."""
        mock_structured = AsyncMock()
        mock_structured.ainvoke.return_value = ValidationOutput(
            approved=False, errors=["Chart title is misleading"]
        )

        with patch("planner.agents.validation_agent.get_settings") as mock_settings, \
             patch("planner.agents.validation_agent.ChatAnthropic") as mock_llm_cls:
            mock_settings.return_value.anthropic_api_key = "test-key"
            mock_settings.return_value.model = "claude-sonnet-4-6"
            mock_settings.return_value.temperature = 0.1
            mock_llm_cls.return_value.with_structured_output.return_value = mock_structured

            result = await validation_node(valid_state)

        assert result["final_plan"] is None
        assert "Chart title is misleading" in result["validation_errors"]

    async def test_validation_node_no_api_key_skips_llm(self, valid_state):
        """When no API key is set, LLM validation is skipped and plan is accepted."""
        with patch("planner.agents.validation_agent.get_settings") as mock_settings, \
             patch("planner.agents.validation_agent.ChatAnthropic") as mock_llm_cls:
            mock_settings.return_value.anthropic_api_key = ""

            result = await validation_node(valid_state)

        mock_llm_cls.assert_not_called()
        assert result["final_plan"] == valid_state["assembled_plan"]
        assert result["validation_errors"] == []
