# e2e-data-cleaning Specification

## Purpose
End-to-end tests for data cleaning operations via chat, including whitespace trimming, case standardization, column renaming, null filling, and undo functionality.

## Requirements

### Requirement: Whitespace trimming e2e test
The e2e suite SHALL include a test that verifies whitespace trimming via chat.

#### Scenario: Trim whitespace from a text column
- **WHEN** the user asks to trim whitespace from a column via chat
- **THEN** the assistant SHALL show a preview with affected cell count
- **WHEN** the user confirms the operation
- **THEN** the table SHALL display trimmed values
- **AND** the assistant SHALL confirm how many cells were cleaned

### Requirement: Case standardization e2e test
The e2e suite SHALL include tests that verify case standardization via chat.

#### Scenario: Convert column to title case
- **WHEN** the user asks to make a column title case via chat
- **THEN** the assistant SHALL show a preview of affected values
- **WHEN** the user confirms the operation
- **THEN** the table SHALL display title-cased values

#### Scenario: Convert column to uppercase
- **WHEN** the user asks to make a column uppercase via chat
- **THEN** the assistant SHALL show a preview
- **WHEN** the user confirms
- **THEN** the table SHALL display uppercased values

### Requirement: Column alias e2e test
The e2e suite SHALL include a test that verifies column renaming via chat.

#### Scenario: Rename a column via chat
- **WHEN** the user asks to rename a column via chat
- **THEN** the column header SHALL update to the new name immediately (no preview step)
- **AND** the assistant SHALL confirm the rename

### Requirement: Null fill e2e test
The e2e suite SHALL include a test that verifies null value filling via chat.

#### Scenario: Fill blanks with a specified value
- **WHEN** the user asks to fill blanks in a column with a specific value
- **THEN** the assistant SHALL show a preview with null cell count
- **WHEN** the user confirms
- **THEN** the table SHALL display the fill value in previously blank cells

### Requirement: Undo cleaning transform e2e test
The e2e suite SHALL include a test that verifies reversibility of cleaning operations.

#### Scenario: Undo most recent cleaning transform
- **WHEN** a cleaning transform has been applied
- **AND** the user says "undo" or "revert that"
- **THEN** the most recent cleaning transform SHALL be disabled
- **AND** the table SHALL revert to showing raw values for that column

### Requirement: Data cleaning tests use isolated datasets
Each data cleaning e2e test SHALL create its own dataset with known dirty data, rather than sharing the global seed dataset.

#### Scenario: Cleaning test seeds its own dataset
- **WHEN** a data cleaning test runs
- **THEN** it SHALL upload a CSV with known data quality issues (leading/trailing spaces, mixed case, nulls)
- **AND** the test SHALL operate on this isolated dataset
- **AND** mutations SHALL NOT affect other tests
