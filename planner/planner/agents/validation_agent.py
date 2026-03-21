"""Validation agent — checks referential integrity and structural coherence."""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field

from planner.agents.prompts.validation import VALIDATION_SYSTEM, VALIDATION_USER
from planner.config import get_settings
from planner.schema.manifest import SemanticManifest
from planner.schema.plan import DashboardPlan


class ValidationOutput(BaseModel):
    errors: list[str] = Field(default_factory=list)
    approved: bool = True


def validate_plan_locally(plan: DashboardPlan, manifest: SemanticManifest) -> list[str]:
    """Pure-code validation for referential integrity and structural coherence."""
    errors = []
    metric_ids = {m.id for m in manifest.metrics}
    dimension_ids = {d.id for d in manifest.dimensions}
    all_column_ids = set()
    ds_ids = {ds.id for ds in manifest.data_sources}
    for ds in manifest.data_sources:
        for col in ds.columns:
            all_column_ids.add(col.id)

    # Check data source references
    for ds_id in plan.data_source_ids:
        if ds_id not in ds_ids:
            errors.append(f"Data source '{ds_id}' not found in manifest")

    # Check filter references
    for f in plan.filters:
        if f.dimension_id not in dimension_ids:
            errors.append(f"Filter dimension '{f.dimension_id}' not found in manifest")

    # Check section components
    for section in plan.sections:
        num_components = len(section.components)
        for row in section.grid:
            for idx in row:
                if idx < 0 or idx >= num_components:
                    errors.append(
                        f"Section '{section.id}' grid index {idx} out of range "
                        f"(0-{num_components - 1})"
                    )

        for comp in section.components:
            spec = comp.spec
            if comp.type == "chart":
                if hasattr(spec, "metric_id") and spec.metric_id:
                    if spec.metric_id not in metric_ids:
                        errors.append(
                            f"Component '{comp.id}' references unknown metric '{spec.metric_id}'"
                        )
                if hasattr(spec, "x_axis") and spec.x_axis:
                    if spec.x_axis not in dimension_ids:
                        errors.append(
                            f"Component '{comp.id}' x_axis '{spec.x_axis}' not in dimensions"
                        )
                if hasattr(spec, "y_axis") and spec.y_axis:
                    y_vals = spec.y_axis if isinstance(spec.y_axis, list) else [spec.y_axis]
                    for y in y_vals:
                        if y not in metric_ids:
                            errors.append(
                                f"Component '{comp.id}' y_axis '{y}' not in metrics"
                            )
            elif comp.type == "table":
                if hasattr(spec, "columns"):
                    for col_id in spec.columns:
                        if col_id not in all_column_ids:
                            errors.append(
                                f"Component '{comp.id}' column '{col_id}' not in manifest"
                            )

    return errors


async def validation_node(state: dict) -> dict:
    """LangGraph node: validate the assembled plan."""
    plan = DashboardPlan.model_validate(state["assembled_plan"])
    manifest = SemanticManifest.model_validate(state["manifest"])

    # First do local pure-code validation
    local_errors = validate_plan_locally(plan, manifest)

    if local_errors:
        return {"validation_errors": local_errors, "final_plan": None}

    # If local validation passes, use LLM for deeper coherence check
    settings = get_settings()
    if not settings.anthropic_api_key:
        # No API key — skip LLM validation, trust local check
        return {"validation_errors": [], "final_plan": state["assembled_plan"]}

    llm = ChatAnthropic(
        model=settings.model,
        temperature=settings.temperature,
        api_key=settings.anthropic_api_key,
    )
    structured_llm = llm.with_structured_output(ValidationOutput)

    import json

    user_msg = VALIDATION_USER.format(
        plan_json=json.dumps(state["assembled_plan"], indent=2),
        manifest_json=json.dumps(state["manifest"], indent=2),
    )

    result: ValidationOutput = await structured_llm.ainvoke(
        [
            {"role": "system", "content": VALIDATION_SYSTEM},
            {"role": "user", "content": user_msg},
        ]
    )

    if result.approved and not result.errors:
        return {"validation_errors": [], "final_plan": state["assembled_plan"]}

    return {"validation_errors": result.errors, "final_plan": None}
