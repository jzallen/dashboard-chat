"""Click CLI for plan generation and dashboard serving."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import click


@click.group()
def cli():
    """Dashboard layout planner — generate and serve Vizro dashboards."""
    pass


@cli.command()
@click.argument("prompt")
@click.option("-m", "--manifest", required=True, type=click.Path(exists=True), help="Manifest JSON")
@click.option("-e", "--existing", type=click.Path(exists=True), help="Existing plan for editing")
@click.option("-o", "--output", required=True, type=click.Path(), help="Output plan JSON path")
def plan(prompt: str, manifest: str, existing: str | None, output: str) -> None:
    """Generate a dashboard plan from a natural language prompt."""
    from planner.agents.orchestrator import run_planner
    from planner.config import get_settings

    settings = get_settings()
    if not settings.anthropic_api_key:
        click.echo("Error: PLANNER_ANTHROPIC_API_KEY environment variable is required.", err=True)
        sys.exit(1)

    manifest_data = json.loads(Path(manifest).read_text())
    existing_data = json.loads(Path(existing).read_text()) if existing else None

    result = asyncio.run(run_planner(prompt, manifest_data, existing_data))

    final_plan = result.get("final_plan")
    if not final_plan:
        click.echo("Error: Pipeline did not produce a final plan.", err=True)
        errors = result.get("validation_errors", [])
        if errors:
            click.echo("Validation errors:", err=True)
            for e in errors:
                click.echo(f"  - {e}", err=True)
        sys.exit(1)

    Path(output).write_text(json.dumps(final_plan, indent=2))
    click.echo(f"Plan written to {output}")


@cli.command()
@click.argument("plan_path", type=click.Path(exists=True))
@click.option("-m", "--manifest", required=True, type=click.Path(exists=True), help="Manifest JSON")
def serve(plan_path: str, manifest: str) -> None:
    """Serve a dashboard from a plan JSON file."""
    from planner.renderer.app import serve as serve_app

    serve_app(plan_path, manifest)


if __name__ == "__main__":
    cli()
