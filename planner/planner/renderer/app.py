"""Vizro app serving — loads a plan and renders a live dashboard."""

from __future__ import annotations

import json
from pathlib import Path

import vizro

from planner.data.hardcoded_warehouse import HardcodedWarehouseRepository
from planner.renderer.data_manager import register_data_sources
from planner.schema.manifest import SemanticManifest
from planner.schema.plan import DashboardPlan
from planner.schema.vizro_builder import build_vizro_dashboard


def serve(plan_path: str | Path, manifest_path: str | Path) -> None:
    """Load a DashboardPlan from JSON, build the Vizro dashboard, and start the server."""
    plan_data = json.loads(Path(plan_path).read_text())
    manifest_data = json.loads(Path(manifest_path).read_text())

    plan = DashboardPlan.model_validate(plan_data)
    manifest = SemanticManifest.model_validate(manifest_data)

    warehouse = HardcodedWarehouseRepository(manifest)
    register_data_sources(warehouse, manifest)

    dashboard = build_vizro_dashboard(plan, manifest)
    app = vizro.Vizro(assets_folder="").build(dashboard)
    app.run()
