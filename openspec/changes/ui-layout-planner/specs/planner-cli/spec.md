## ADDED Requirements

### Requirement: Plan command generates dashboard plans
The system SHALL provide a `planner plan` CLI command that accepts a natural language prompt, a manifest file path (`-m`), an optional existing plan for editing (`-e`), and an output path (`-o`). It SHALL invoke the agent pipeline and write the resulting DashboardPlan as JSON to the output path.

#### Scenario: Generate new plan
- **WHEN** `planner plan "Build a patient demographics dashboard" -m manifest.json -o plan.json` is executed
- **THEN** the system SHALL run the agent pipeline and write a valid DashboardPlan JSON to plan.json

#### Scenario: Edit existing plan
- **WHEN** `planner plan "Add a readmission trend chart" -m manifest.json -e plan.json -o plan_v2.json` is executed
- **THEN** the system SHALL load the existing plan, run the edit workflow, and write the modified plan to plan_v2.json

#### Scenario: Missing manifest file
- **WHEN** the `-m` path does not exist
- **THEN** the CLI SHALL exit with a non-zero code and an error message

### Requirement: Serve command renders dashboards
The system SHALL provide a `planner serve` CLI command that accepts a plan JSON path and a manifest file path (`-m`). It SHALL build and serve the Vizro dashboard.

#### Scenario: Serve a generated plan
- **WHEN** `planner serve plan.json -m manifest.json` is executed
- **THEN** the system SHALL start a Vizro/Dash server rendering the dashboard defined in plan.json

### Requirement: Configuration via environment variables
The system SHALL use `pydantic-settings` with env prefix `PLANNER_` for configuration. Supported settings: `PLANNER_ANTHROPIC_API_KEY`, `PLANNER_MODEL` (default "claude-sonnet-4-6"), `PLANNER_TEMPERATURE` (default 0.1).

#### Scenario: Custom model override
- **WHEN** `PLANNER_MODEL` is set to a different model name
- **THEN** all LLM agents SHALL use the specified model

#### Scenario: Missing API key
- **WHEN** `PLANNER_ANTHROPIC_API_KEY` is not set and no other Anthropic key is available
- **THEN** the plan command SHALL exit with a clear error message about the missing key
