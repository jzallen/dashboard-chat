"""Plotly figure builder functions for each chart type."""

from __future__ import annotations

from typing import Callable

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go


def build_bar(df: pd.DataFrame, x: str, y: str, color: str | None = None, **kwargs) -> go.Figure:
    return px.bar(df, x=x, y=y, color=color, **kwargs)


def build_line(df: pd.DataFrame, x: str, y: str, color: str | None = None, **kwargs) -> go.Figure:
    return px.line(df, x=x, y=y, color=color, **kwargs)


def build_area(df: pd.DataFrame, x: str, y: str, color: str | None = None, **kwargs) -> go.Figure:
    return px.area(df, x=x, y=y, color=color, **kwargs)


def build_scatter(
    df: pd.DataFrame, x: str, y: str, color: str | None = None, **kwargs
) -> go.Figure:
    return px.scatter(df, x=x, y=y, color=color, **kwargs)


def build_pie(df: pd.DataFrame, names: str, values: str, **kwargs) -> go.Figure:
    return px.pie(df, names=names, values=values, **kwargs)


def build_histogram(df: pd.DataFrame, x: str, color: str | None = None, **kwargs) -> go.Figure:
    return px.histogram(df, x=x, color=color, **kwargs)


def build_kpi_card(df: pd.DataFrame, metric_id: str, fmt: str | None = None) -> go.Figure:
    value = df[metric_id].iloc[0] if not df.empty else 0
    display = format(value, fmt) if fmt else str(value)
    fig = go.Figure(go.Indicator(mode="number", value=value, number={"valueformat": fmt or ""}))
    fig.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=150)
    return fig


CHART_REGISTRY: dict[str, Callable[..., go.Figure]] = {
    "bar": build_bar,
    "line": build_line,
    "area": build_area,
    "scatter": build_scatter,
    "pie": build_pie,
    "histogram": build_histogram,
    "kpi_card": build_kpi_card,
}
