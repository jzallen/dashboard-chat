## ADDED Requirements

### Requirement: CsvPlugin Reference Implementation

The system SHALL provide a `CsvPlugin` class in `backend/app/plugins/csv_plugin.py` that implements the `FileFormatPlugin` protocol. This plugin SHALL be the reference implementation for plugin developers and SHALL reproduce the exact behavior of the current inline CSV processing.

- `name` SHALL be `"csv"`.
- `extensions` SHALL be `[".csv"]`.
- `detect_choices()` SHALL always return `None` (CSV requires no user choices).
- `validate()` SHALL reject empty files with `PluginValidationError`.
- `process()` SHALL parse CSV bytes using pandas `read_csv()`, strip whitespace from headers and string values, and return a `ProcessingResult` with the DataFrame.

#### Scenario: Valid CSV file is processed
- **WHEN** a valid CSV file with headers "name,age,city" and 3 data rows is uploaded
- **THEN** `CsvPlugin.process()` SHALL return a `ProcessingResult` with a DataFrame containing 3 rows and 3 columns
- **THEN** column headers SHALL have whitespace stripped
- **THEN** string values SHALL have whitespace stripped

#### Scenario: Empty CSV file is rejected
- **WHEN** an empty file (0 bytes) with `.csv` extension is uploaded
- **THEN** `CsvPlugin.validate()` SHALL raise `PluginValidationError` with message indicating the file is empty

#### Scenario: CSV with only headers (no data rows) is processed
- **WHEN** a CSV file contains only a header row with no data rows
- **THEN** `CsvPlugin.process()` SHALL return a `ProcessingResult` with a DataFrame containing 0 rows
- **THEN** the DataFrame SHALL have columns matching the headers

#### Scenario: CSV plugin returns no optional metadata
- **WHEN** any CSV file is processed
- **THEN** `ProcessingResult.schema_hints` SHALL be `None`
- **THEN** `ProcessingResult.default_transforms` SHALL be `None`
- **THEN** `ProcessingResult.dbt_macros` SHALL be `None`
- **THEN** `ProcessingResult.chat_guidance` SHALL be `None`

---

### Requirement: Backward Compatibility

After refactoring CSV processing into a plugin, the end-to-end behavior for CSV uploads SHALL be identical to pre-refactor behavior. No user-facing change SHALL occur.

- The upload response shape SHALL remain unchanged.
- Schema inference results SHALL be identical.
- Column profiling results SHALL be identical.
- The stored Parquet files SHALL be identical.
- Existing tests for CSV upload SHALL pass without modification (after updating import paths if needed).

#### Scenario: CSV upload produces same dataset as before
- **WHEN** the same CSV file is uploaded before and after the plugin refactor
- **THEN** the resulting `schema_config` SHALL be identical
- **THEN** the resulting `column_profiles` SHALL be identical
- **THEN** the resulting `preview_rows` SHALL be identical
