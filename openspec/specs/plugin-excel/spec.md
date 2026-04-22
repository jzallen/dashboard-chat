## Purpose

Describes the `ExcelPlugin` implementation for `.xlsx` and `.xls` files. It supports both single-sheet files (immediate processing) and multi-sheet workbooks (interactive sheet selection via the two-phase plugin protocol), giving analysts a smooth Excel-ingest path.

## Requirements

### Requirement: ExcelPlugin Implementation

The system SHALL provide an `ExcelPlugin` class in `backend/app/plugins/excel_plugin.py` that implements the `FileFormatPlugin` protocol for Excel spreadsheet files.

- `name` SHALL be `"excel"`.
- `extensions` SHALL be `[".xlsx", ".xls"]`.
- `validate()` SHALL reject files that cannot be parsed by `openpyxl` (corrupt or non-Excel files).
- `process()` SHALL read the selected sheet into a pandas DataFrame using `pd.read_excel()`.
- The plugin SHALL use `openpyxl` as the engine for `.xlsx` files.

#### Scenario: Single-sheet Excel file is processed directly
- **WHEN** an `.xlsx` file with one sheet named "Data" containing headers and 50 rows is uploaded
- **THEN** `detect_choices()` SHALL return `None` (no user choice needed)
- **THEN** `process()` SHALL return a `ProcessingResult` with a 50-row DataFrame from that sheet

#### Scenario: Corrupt Excel file is rejected
- **WHEN** a file with `.xlsx` extension that is not a valid Excel file is uploaded
- **THEN** `validate()` SHALL raise `PluginValidationError` with message "Invalid Excel file: unable to read workbook"

---

### Requirement: Multi-Sheet Selection

When an Excel file contains multiple sheets, the plugin SHALL require the user to select which sheet to import via the interactive processing model.

- `detect_choices()` SHALL inspect the workbook for sheet names.
- If the workbook has exactly one sheet, `detect_choices()` SHALL return `None`.
- If the workbook has multiple sheets, `detect_choices()` SHALL return a `PluginChoice` with `key="sheet_name"` and `options` listing all sheet names.
- `process()` SHALL read only the sheet identified by `choices["sheet_name"]`.
- If `choices["sheet_name"]` does not match any sheet in the workbook, `process()` SHALL raise `PluginValidationError`.

#### Scenario: Excel file with 3 sheets prompts selection
- **WHEN** an `.xlsx` file with sheets ["Revenue", "Expenses", "Summary"] is uploaded
- **THEN** `detect_choices()` SHALL return `[PluginChoice(key="sheet_name", label="Select a sheet to import", options=["Revenue", "Expenses", "Summary"])]`

#### Scenario: User selects a sheet for processing
- **WHEN** `process()` is called with `choices={"sheet_name": "Expenses"}`
- **THEN** the plugin SHALL read only the "Expenses" sheet
- **THEN** the resulting DataFrame SHALL contain the data from the "Expenses" sheet only

#### Scenario: Invalid sheet name is rejected
- **WHEN** `process()` is called with `choices={"sheet_name": "NonExistent"}`
- **THEN** the plugin SHALL raise `PluginValidationError` with message indicating the sheet was not found

---

### Requirement: Excel Data Type Handling

The plugin SHALL preserve Excel cell types where possible and handle common Excel data patterns.

- Numeric cells SHALL be preserved as numeric types in the DataFrame.
- Date cells SHALL be parsed as datetime types.
- Formula cells SHALL be read as their computed values (not the formula text).
- Empty cells SHALL be represented as `NaN`/`None` in the DataFrame.

#### Scenario: Excel with mixed types preserves types
- **WHEN** an Excel file has a column with numeric values, a column with dates, and a column with text
- **THEN** the resulting DataFrame SHALL have appropriate pandas dtypes for each column
- **THEN** schema inference SHALL map them to the correct platform types

#### Scenario: Empty cells become null
- **WHEN** an Excel file has cells with no content
- **THEN** those cells SHALL be `NaN` in the resulting DataFrame
