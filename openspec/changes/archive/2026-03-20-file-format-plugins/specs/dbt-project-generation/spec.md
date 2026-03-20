## MODIFIED Requirements

### Requirement: dbt Project File Structure

The system SHALL generate a zip archive containing a complete, valid dbt project directory structure when exporting a project with datasets.

- The zip archive SHALL contain the following files at minimum:
  - `dbt_project.yml` at the archive root
  - `profiles.yml` at the archive root
  - `models/staging/sources.yml`
  - `models/schema.yml`
  - `README.md` at the archive root
- For each dataset in the project, the zip SHALL contain a staging model SQL file at `models/staging/stg_{snake_case_name}.sql`.
- The zip SHALL NOT contain any files outside the expected dbt project structure.
- The zip SHALL be generated entirely in memory using Python's `zipfile` module with `BytesIO`.
- If any registered plugin contributes dbt macros (via class-level `dbt_macros` attribute or per-dataset `ProcessingResult.dbt_macros`), the zip SHALL include a `macros/` directory with those macro files.

#### Scenario: Export a project with two datasets
- **WHEN** a project named "Sales Pipeline" has two datasets named "Leads" and "Opportunities" with transforms applied
- **THEN** the generated zip SHALL contain `dbt_project.yml`, `profiles.yml`, `models/staging/sources.yml`, `models/schema.yml`, `README.md`, `models/staging/stg_leads.sql`, and `models/staging/stg_opportunities.sql`
- **THEN** every file in the zip SHALL be a valid text file (UTF-8 encoded)

#### Scenario: Export an empty project with no datasets
- **WHEN** a project has no datasets
- **THEN** the generated zip SHALL contain `dbt_project.yml`, `profiles.yml`, `models/staging/sources.yml`, `models/schema.yml`, and `README.md`
- **THEN** the `models/staging/` directory SHALL contain no `stg_*.sql` files
- **THEN** `sources.yml` SHALL contain an empty tables list
- **THEN** `schema.yml` SHALL contain an empty models list

#### Scenario: Export includes plugin-contributed macros
- **WHEN** the HL7v2 plugin defines class-level `dbt_macros = {"parse_hl7_segment": "CREATE MACRO ..."}` and a project has datasets
- **THEN** the zip SHALL contain `macros/plugin_hl7v2.sql` (or similar) with the macro definitions
- **THEN** the macros file SHALL be in addition to the existing `macros/custom_functions.sql`

## ADDED Requirements

### Requirement: Plugin Macro Collection in dbt Export

The dbt project generator SHALL collect custom macros from all registered plugins and include them in the exported project's `macros/` directory.

- The generator SHALL query the plugin registry for all plugins that define a `dbt_macros` class attribute.
- Each plugin's macros SHALL be written to a separate file: `macros/plugin_{plugin_name}.sql`.
- Plugin macro files SHALL only be created if the plugin defines at least one macro.
- Plugin macros SHALL NOT conflict with existing utility macros in `macros/custom_functions.sql`.
- The `dbt_project.yml` macro-paths configuration SHALL remain `["macros"]` (already includes all files in the directory).

#### Scenario: Multiple plugins contribute macros
- **WHEN** the HL7v2 plugin defines 2 macros and the FHIR plugin defines 1 macro
- **THEN** the zip SHALL contain `macros/plugin_hl7v2.sql` with 2 macro definitions
- **THEN** the zip SHALL contain `macros/plugin_fhir.sql` with 1 macro definition
- **THEN** `macros/custom_functions.sql` SHALL remain unchanged

#### Scenario: No plugins contribute macros
- **WHEN** no registered plugins define `dbt_macros`
- **THEN** only `macros/custom_functions.sql` SHALL be present in the macros directory
- **THEN** the export behavior SHALL be identical to pre-plugin behavior
