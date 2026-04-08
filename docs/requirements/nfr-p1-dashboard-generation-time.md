# NFR-P1: Dashboard Generation Time

## Tag

P1 — Preview: Performance

## Ambition

Generate a complete dashboard from a natural language prompt within a timeframe that keeps the user engaged in the design loop.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Wall-clock time from natural language prompt to rendered dashboard in preview tab |
| **Meter** | End-to-end including LangGraph pipeline + Vizro rendering |
| **Must** | < 120 seconds |
| **Plan** | < 60 seconds |
| **Wish** | < 30 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Submits a natural language prompt requesting a dashboard |
| **Environment** | Normal operation |
| **Artifact** | LangGraph pipeline + Vizro rendering engine |
| **Response** | System generates and renders a complete dashboard in the preview tab |
| **Response Measure** | End-to-end latency < 120 s (Must) / < 60 s (Plan) / < 30 s (Wish) |

## Status

**Not measured** — planner is standalone CLI

## Verification Method

Measure end-to-end wall-clock time from prompt submission to fully rendered dashboard across representative prompts.

## Related

- `planner-docker-integration` proposal
