# File Format Plugin Interface

## Purpose

Defines the protocol, data types, and return contracts for file format plugins. Plugins process uploaded files into tabular DataFrames with optional metadata for schema inference, chat guidance, and multi-dataset output.

## Requirements

### Requirement: ProcessingResult Data Class

The system SHALL define a `ProcessingResult` dataclass that plugins return from `process()`. The result SHALL contain the tabular DataFrame and optional metadata.

- `df: pd.DataFrame` — the processed tabular data (REQUIRED)
- `schema_hints: dict[str, str] | None` — column type overrides (optional, maps column name to schema type)
- `default_transforms: list[dict] | None` — transforms to auto-apply (optional)
- `dbt_macros: dict[str, str] | None` — per-file dbt macros (optional, maps macro name to SQL body)
- `chat_guidance: str | None` — format-specific LLM context (optional)
- `name: str | None` — dataset name label for multi-dataset results (optional, defaults to None for single-dataset plugins)

#### Scenario: Plugin returns DataFrame only
- **WHEN** a plugin returns `ProcessingResult(df=dataframe)` with no optional fields
- **THEN** the platform SHALL use default schema inference on the DataFrame
- **THEN** no default transforms SHALL be applied
- **THEN** no additional chat guidance SHALL be injected

#### Scenario: Plugin returns schema hints
- **WHEN** a plugin returns `ProcessingResult(df=dataframe, schema_hints={"age": "number", "name": "text"})`
- **THEN** the platform SHALL use the plugin's type mappings instead of inference for the specified columns
- **THEN** columns not in `schema_hints` SHALL still use default inference

#### Scenario: Plugin returns named result for multi-dataset
- **WHEN** a plugin returns `ProcessingResult(df=dataframe, name="Patient")`
- **THEN** the platform SHALL use `"Patient"` as the dataset name when creating the dataset record

---

### Requirement: MultiProcessingResult Data Class

The system SHALL define a `MultiProcessingResult` dataclass for plugins that produce multiple datasets from a single upload. It SHALL contain a list of `ProcessingResult` items, each representing one output dataset.

- `results: list[ProcessingResult]` — one or more named processing results (REQUIRED, each item MUST have `name` set)
- `chat_guidance: str | None` — overall guidance describing the relationship between the datasets (optional)

#### Scenario: Multi-dataset plugin returns multiple results
- **WHEN** a plugin returns `MultiProcessingResult(results=[ProcessingResult(df=df1, name="Patient"), ProcessingResult(df=df2, name="Observation")])`
- **THEN** the platform SHALL create two datasets named "Patient" and "Observation"
- **THEN** each dataset SHALL use its own `schema_hints` and `chat_guidance`

#### Scenario: MultiProcessingResult with unnamed items is rejected
- **WHEN** a plugin constructs `MultiProcessingResult` with a `ProcessingResult` that has `name=None`
- **THEN** `MultiProcessingResult.__post_init__` SHALL raise `ValueError` indicating all items must be named

#### Scenario: Empty results list is rejected
- **WHEN** a plugin constructs `MultiProcessingResult(results=[])`
- **THEN** `MultiProcessingResult.__post_init__` SHALL raise `ValueError` indicating at least one result is required

---

### Requirement: FileFormatPlugin process return type

The `FileFormatPlugin.process()` method SHALL accept a return type of `ProcessingResult | MultiProcessingResult`. Existing plugins returning `ProcessingResult` SHALL continue to work without modification.

#### Scenario: CSV plugin returns single ProcessingResult
- **WHEN** the CSV plugin processes a file
- **THEN** it SHALL return `ProcessingResult` (unchanged from current behavior)
- **THEN** the platform SHALL handle it via the single-dataset path

#### Scenario: FHIR plugin returns MultiProcessingResult
- **WHEN** the FHIR plugin processes a Bundle with multiple resource types
- **THEN** it SHALL return `MultiProcessingResult`
- **THEN** the platform SHALL handle it via the multi-dataset path
