"""Planner configuration via environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class PlannerSettings(BaseSettings):
    model_config = {"env_prefix": "PLANNER_"}

    anthropic_api_key: str = ""
    model: str = "claude-sonnet-4-6"
    temperature: float = 0.1


def get_settings() -> PlannerSettings:
    return PlannerSettings()
