"""Tests for the Click CLI."""

import json
from unittest.mock import AsyncMock, patch

import pytest
from click.testing import CliRunner

from planner.cli import cli


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def manifest_file(tmp_path, sample_manifest):
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps(sample_manifest))
    return str(p)


class TestPlanCommand:
    def test_plan_command_success(self, runner, manifest_file, tmp_path):
        output_path = str(tmp_path / "plan.json")
        fake_plan = {"title": "Test", "sections": []}

        with patch("planner.config.get_settings") as mock_settings, \
             patch("planner.agents.orchestrator.run_planner", new_callable=AsyncMock) as mock_run:
            mock_settings.return_value.anthropic_api_key = "test-key"
            mock_run.return_value = {"final_plan": fake_plan}

            result = runner.invoke(cli, ["plan", "show sales", "-m", manifest_file, "-o", output_path])

        assert result.exit_code == 0
        assert "Plan written to" in result.output
        written = json.loads(open(output_path).read())
        assert written == fake_plan

    def test_plan_command_no_final_plan(self, runner, manifest_file, tmp_path):
        output_path = str(tmp_path / "plan.json")

        with patch("planner.config.get_settings") as mock_settings, \
             patch("planner.agents.orchestrator.run_planner", new_callable=AsyncMock) as mock_run:
            mock_settings.return_value.anthropic_api_key = "test-key"
            mock_run.return_value = {"final_plan": None, "validation_errors": ["bad layout"]}

            result = runner.invoke(cli, ["plan", "show sales", "-m", manifest_file, "-o", output_path])

        assert result.exit_code == 1
        assert "bad layout" in result.output

    def test_plan_command_missing_api_key(self, runner, manifest_file, tmp_path):
        output_path = str(tmp_path / "plan.json")

        with patch("planner.config.get_settings") as mock_settings:
            mock_settings.return_value.anthropic_api_key = ""

            result = runner.invoke(cli, ["plan", "show sales", "-m", manifest_file, "-o", output_path])

        assert result.exit_code == 1
        assert "PLANNER_ANTHROPIC_API_KEY" in result.output

    def test_plan_command_missing_manifest(self, runner, tmp_path):
        output_path = str(tmp_path / "plan.json")
        result = runner.invoke(cli, ["plan", "show sales", "-m", "/nonexistent/manifest.json", "-o", output_path])
        assert result.exit_code != 0


class TestServeCommand:
    def test_serve_command(self, runner, manifest_file, tmp_path, sample_dashboard_plan):
        plan_file = str(tmp_path / "plan.json")
        with open(plan_file, "w") as f:
            json.dump(sample_dashboard_plan, f)

        with patch("planner.renderer.app.serve") as mock_serve:
            result = runner.invoke(cli, ["serve", plan_file, "-m", manifest_file])

        assert result.exit_code == 0
        mock_serve.assert_called_once_with(plan_file, manifest_file)
