"""Section agent — produces a SectionPlan with components, specs, and grid layout."""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic

from planner.agents.prompts.section import SECTION_SYSTEM, SECTION_USER
from planner.config import get_settings
from planner.schema.manifest import SemanticManifest
from planner.schema.plan import SectionPlan


def _metrics_detail(manifest: SemanticManifest, metric_ids: list[str]) -> str:
    details = []
    for m in manifest.metrics:
        if m.id in metric_ids:
            details.append(f"  - {m.id}: {m.label} ({m.expression}, type={m.type})")
    return "\n".join(details) or "  (none specified)"


def _dimensions_detail(manifest: SemanticManifest, dimension_ids: list[str]) -> str:
    details = []
    for d in manifest.dimensions:
        if d.id in dimension_ids:
            extra = f", granularity={d.time_granularity}" if d.time_granularity else ""
            details.append(f"  - {d.id}: {d.label} ({d.type}{extra})")
    return "\n".join(details) or "  (none specified)"


async def section_node(state: dict) -> dict:
    """LangGraph node: produce a SectionPlan for one section outline.

    Expects state to contain 'section_outline' and 'manifest'.
    """
    settings = get_settings()
    llm = ChatAnthropic(
        model=settings.model,
        temperature=settings.temperature,
        api_key=settings.anthropic_api_key or None,
    )
    structured_llm = llm.with_structured_output(SectionPlan)

    manifest = SemanticManifest.model_validate(state["manifest"])
    outline = state["section_outline"]

    user_msg = SECTION_USER.format(
        section_id=outline["id"],
        section_title=outline["title"],
        section_purpose=outline["purpose"],
        metric_ids=", ".join(outline.get("metric_ids", [])),
        dimension_ids=", ".join(outline.get("dimension_ids", [])),
        metrics_detail=_metrics_detail(manifest, outline.get("metric_ids", [])),
        dimensions_detail=_dimensions_detail(manifest, outline.get("dimension_ids", [])),
    )

    result: SectionPlan = await structured_llm.ainvoke(
        [
            {"role": "system", "content": SECTION_SYSTEM},
            {"role": "user", "content": user_msg},
        ]
    )

    return {"section_results": [result.model_dump()]}
