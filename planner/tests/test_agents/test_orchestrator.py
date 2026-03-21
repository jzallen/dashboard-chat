"""Tests for the orchestrator — mock all agents, verify pipeline wiring and retry."""

from unittest.mock import AsyncMock, patch

import pytest

from planner.agents.orchestrator import (
    MAX_RETRIES,
    PlannerState,
    _route_after_validation,
)
from langgraph.graph import END


class TestOrchestratorRouting:
    def test_route_to_end_when_final_plan(self):
        state: PlannerState = {
            "user_prompt": "",
            "manifest": {},
            "existing_plan": None,
            "section_plan": None,
            "section_results": [],
            "filter_results": None,
            "assembled_plan": None,
            "validation_errors": [],
            "final_plan": {"title": "Done"},
            "iteration_count": 0,
        }
        assert _route_after_validation(state) == END

    def test_route_to_retry_when_errors_and_under_max(self):
        state: PlannerState = {
            "user_prompt": "",
            "manifest": {},
            "existing_plan": None,
            "section_plan": None,
            "section_results": [],
            "filter_results": None,
            "assembled_plan": {"title": "Draft"},
            "validation_errors": ["some error"],
            "final_plan": None,
            "iteration_count": 1,
        }
        assert _route_after_validation(state) == "planner_agent"

    def test_route_to_best_effort_when_max_retries(self):
        state: PlannerState = {
            "user_prompt": "",
            "manifest": {},
            "existing_plan": None,
            "section_plan": None,
            "section_results": [],
            "filter_results": None,
            "assembled_plan": {"title": "Draft"},
            "validation_errors": ["some error"],
            "final_plan": None,
            "iteration_count": MAX_RETRIES,
        }
        assert _route_after_validation(state) == "finalize_best_effort"


class TestOrchestratorGraph:
    def test_graph_compiles(self):
        from planner.agents.orchestrator import compile_graph

        app = compile_graph()
        assert app is not None
