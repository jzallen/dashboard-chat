## ADDED Requirements

### Requirement: PlannerState TypedDict
The system SHALL define a `PlannerState` TypedDict for LangGraph state containing: `user_prompt` (str), `manifest` (dict), `existing_plan` (dict | None), `section_plan` (dict | None), `section_results` (list[dict] with append reducer), `filter_results` (dict | None), `assembled_plan` (dict | None), `validation_errors` (list[str]), `final_plan` (dict | None), and `iteration_count` (int).

#### Scenario: State initialization
- **WHEN** the orchestrator is invoked with a prompt and manifest
- **THEN** the state SHALL be initialized with user_prompt, manifest (as dict via model_dump), and iteration_count 0

### Requirement: Planner agent decides section structure
The system SHALL implement a planner agent that receives the user prompt, manifest summary, and optional existing plan, and produces a list of section outlines. Each outline SHALL contain id, title, purpose, and relevant metric/dimension ids.

#### Scenario: New dashboard planning
- **WHEN** the planner agent receives a prompt and manifest with no existing plan
- **THEN** it SHALL output section outlines appropriate to the prompt

#### Scenario: Edit existing dashboard
- **WHEN** the planner agent receives a prompt, manifest, and existing plan
- **THEN** it SHALL mark sections as "keep", "modify", "add", or "remove"

### Requirement: Section agent builds one section
The system SHALL implement a section agent that receives a section outline and manifest slice and produces a complete `SectionPlan` with components, specs, and grid layout.

#### Scenario: KPI section generation
- **WHEN** the section agent receives an outline for a KPI section with metric ids
- **THEN** it SHALL produce a SectionPlan containing kpi_card ChartSpecs for each metric

### Requirement: Filter agent determines sidebar filters
The system SHALL implement a filter agent that receives the manifest dimensions and user prompt and produces a list of `FilterSpec` entries with appropriate widget types.

#### Scenario: Categorical dimension filter
- **WHEN** the manifest contains a categorical dimension with low cardinality
- **THEN** the filter agent SHALL assign a "dropdown" or "checklist" widget type

#### Scenario: Time dimension filter
- **WHEN** the manifest contains a time dimension
- **THEN** the filter agent SHALL assign a "date_picker" widget type

### Requirement: Assembler merges outputs deterministically
The system SHALL implement an assembler as pure code (no LLM calls) that merges all section results and filter results into a complete `DashboardPlan`. For edits, unchanged sections SHALL be passed through preserving component IDs.

#### Scenario: Merge parallel results
- **WHEN** section agents produce 3 SectionPlans and the filter agent produces FilterSpecs
- **THEN** the assembler SHALL produce a single DashboardPlan containing all sections and filters

#### Scenario: Edit preserves unchanged sections
- **WHEN** the planner marked a section as "keep"
- **THEN** the assembler SHALL include the original section unchanged in the output

### Requirement: Validation agent checks coherence
The system SHALL implement a validation agent that checks the assembled plan against the manifest for referential integrity (all metric/dimension/column IDs exist in manifest) and structural coherence (grid indices match component count).

#### Scenario: Valid plan passes
- **WHEN** all references in the plan resolve to manifest entries
- **THEN** the validation agent SHALL approve the plan with no errors

#### Scenario: Invalid reference detected
- **WHEN** a ChartSpec references a metric_id not in the manifest
- **THEN** the validation agent SHALL return an error describing the invalid reference

### Requirement: Orchestrator wires the pipeline with retry
The system SHALL implement a LangGraph StateGraph that chains: planner_agent → Send() fan-out to parallel section_agents + filter_agent → assembler → validation_agent. If validation fails, the pipeline SHALL retry from the planner agent with error feedback, up to a maximum of 2 retries.

#### Scenario: Successful pipeline execution
- **WHEN** the orchestrator runs with a valid prompt and manifest
- **THEN** it SHALL produce a final_plan in the state after all agents complete

#### Scenario: Validation failure triggers retry
- **WHEN** the validation agent returns errors on first attempt
- **THEN** the orchestrator SHALL re-invoke the planner agent with the errors, incrementing iteration_count

#### Scenario: Max retries exceeded
- **WHEN** validation fails after 2 retries (iteration_count reaches 2)
- **THEN** the orchestrator SHALL return the best available plan with validation_errors populated

### Requirement: LLM structured output via langchain-anthropic
Each LLM agent SHALL use `ChatAnthropic` with `with_structured_output()` to produce typed Pydantic models. The model SHALL default to `claude-sonnet-4-6` with temperature 0.1.

#### Scenario: Structured output parsing
- **WHEN** an agent invokes the LLM with a Pydantic output schema
- **THEN** the response SHALL be a validated instance of that schema
