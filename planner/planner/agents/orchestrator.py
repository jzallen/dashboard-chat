"""LangGraph orchestrator — wires the multi-agent pipeline with Send() fan-out and retry."""

from __future__ import annotations

from typing import Annotated

from langgraph.types import Send
from langgraph.graph import END, StateGraph
from typing_extensions import TypedDict

from planner.agents.assembler import assemble_dashboard
from planner.agents.filter_agent import filter_node
from planner.agents.planner_agent import planner_node
from planner.agents.section_agent import section_node
from planner.agents.validation_agent import validation_node


def _append_reducer(existing: list, new: list) -> list:
    return existing + new


class PlannerState(TypedDict):
    user_prompt: str
    manifest: dict
    existing_plan: dict | None
    section_plan: dict | None
    section_results: Annotated[list[dict], _append_reducer]
    filter_results: dict | None
    assembled_plan: dict | None
    validation_errors: list[str]
    final_plan: dict | None
    iteration_count: int


MAX_RETRIES = 2


def _fan_out_sections(state: PlannerState) -> list[Send]:
    """Create a Send() for each section outline that needs generation."""
    section_plan = state.get("section_plan") or {}
    sections = section_plan.get("sections", [])

    sends = []
    for outline in sections:
        if outline.get("action", "add") in ("add", "modify"):
            sends.append(
                Send(
                    "section_agent",
                    {
                        "section_outline": outline,
                        "manifest": state["manifest"],
                    },
                )
            )

    return sends


def _route_after_validation(state: PlannerState) -> str:
    """Decide whether to retry or finish after validation."""
    if state.get("final_plan") is not None:
        return END

    if state.get("iteration_count", 0) >= MAX_RETRIES:
        return "finalize_best_effort"

    return "planner_agent"


async def _finalize_best_effort(state: PlannerState) -> dict:
    """When max retries exhausted, return assembled plan with errors."""
    return {"final_plan": state.get("assembled_plan")}


async def _increment_iteration(state: PlannerState) -> dict:
    """Reset section_results for retry and increment counter."""
    return {
        "iteration_count": state.get("iteration_count", 0) + 1,
        "section_results": [],
    }


def build_graph() -> StateGraph:
    """Construct the LangGraph StateGraph for the planner pipeline."""
    graph = StateGraph(PlannerState)

    graph.add_node("planner_agent", planner_node)
    graph.add_node("section_agent", section_node)
    graph.add_node("filter_agent", filter_node)
    graph.add_node("assembler", assemble_dashboard)
    graph.add_node("validation_agent", validation_node)
    graph.add_node("finalize_best_effort", _finalize_best_effort)
    graph.add_node("increment_iteration", _increment_iteration)

    graph.set_entry_point("planner_agent")

    # After planner: fan out to parallel section agents + filter agent.
    # LangGraph's Send() fan-out combined with `Annotated[list, _append_reducer]`
    # on `section_results` ensures proper fan-in synchronization: the assembler
    # node runs exactly once after ALL parallel section_agent branches and the
    # filter_agent have completed, not once per branch.
    graph.add_conditional_edges("planner_agent", _fan_out_sections)
    graph.add_edge("planner_agent", "filter_agent")

    # Section agents and filter agent feed into assembler
    graph.add_edge("section_agent", "assembler")
    graph.add_edge("filter_agent", "assembler")

    # Assembler feeds into validation
    graph.add_edge("assembler", "validation_agent")

    # After validation: either done, retry, or best-effort
    graph.add_conditional_edges(
        "validation_agent",
        _route_after_validation,
        {
            END: END,
            "planner_agent": "increment_iteration",
            "finalize_best_effort": "finalize_best_effort",
        },
    )

    graph.add_edge("increment_iteration", "planner_agent")
    graph.add_edge("finalize_best_effort", END)

    return graph


def compile_graph():
    """Build and compile the planner graph."""
    return build_graph().compile()


async def run_planner(
    user_prompt: str,
    manifest: dict,
    existing_plan: dict | None = None,
) -> dict:
    """Run the planner pipeline and return the final plan."""
    app = compile_graph()
    initial_state: PlannerState = {
        "user_prompt": user_prompt,
        "manifest": manifest,
        "existing_plan": existing_plan,
        "section_plan": None,
        "section_results": [],
        "filter_results": None,
        "assembled_plan": None,
        "validation_errors": [],
        "final_plan": None,
        "iteration_count": 0,
    }

    result = await app.ainvoke(initial_state)
    return result
