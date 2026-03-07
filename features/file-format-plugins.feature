Feature: File Format Plugin System
  As a platform developer
  I can register file format plugins
  To extend the platform with custom file processing beyond CSV

  Background:
    Given the platform has a plugin registry
    And a project is loaded in the application

  # --- Plugin Registration ---

  Scenario: Platform ships with a built-in CSV plugin
    Given no additional plugins are installed
    When a user opens the upload dialog
    Then CSV is available as a supported file format
    And the CSV plugin handles parsing, schema inference, and parquet conversion

  Scenario: Developer registers a new file format plugin
    Given a developer has created a plugin conforming to the FileFormatPlugin interface
    When the plugin is registered with the plugin registry
    Then the plugin's supported file extensions appear in the upload dialog
    And files matching those extensions are routed to the plugin for processing

  Scenario: Multiple plugins coexist without conflict
    Given plugins are registered for CSV, Excel, HL7v2, and FHIR
    When a user opens the upload dialog
    Then all four format types are available for selection
    And each file is processed by the correct plugin based on its format

  Scenario: Plugin registration fails gracefully for invalid plugins
    Given a plugin that does not conform to the FileFormatPlugin interface
    When registration is attempted
    Then the registration is rejected with a clear error message
    And existing plugins continue to function

  # --- Upload Flow with Plugins ---

  Scenario: Upload an Excel file via Excel plugin
    Given the Excel plugin is registered
    And the upload widget is displayed in the chat
    When the user selects an .xlsx file
    Then the widget shows the filename with "Send" button
    When the user clicks "Send"
    Then the Excel plugin extracts the selected sheet as tabular data
    And a dataset is created with inferred schema
    And the dataset appears in the sidebar and grid

  Scenario: Excel file with multiple sheets prompts user for selection
    Given the Excel plugin is registered
    When the user uploads an .xlsx file with multiple sheets
    Then the chat displays the available sheet names
    And the user is prompted to select which sheet to import
    When the user selects a sheet
    Then that sheet is processed into a dataset

  Scenario: Upload an HL7v2 message file via HL7v2 plugin
    Given the HL7v2 plugin is registered
    When the user uploads a file containing HL7v2 messages
    Then the plugin parses the HL7 segments into a flat tabular structure
    And a dataset is created with columns derived from segment fields
    And the dataset conforms to the data lake parquet format

  Scenario: Upload a FHIR bundle via FHIR plugin
    Given the FHIR plugin is registered
    When the user uploads a FHIR JSON bundle
    Then the plugin extracts resources of the specified type into rows
    And a dataset is created with columns mapped from FHIR resource fields
    And the dataset conforms to the data lake parquet format

  Scenario: FHIR bundle with multiple resource types prompts user
    Given the FHIR plugin is registered
    When the user uploads a FHIR bundle containing multiple resource types
    Then the chat displays the resource types found (e.g., Patient, Observation, Encounter)
    And the user is prompted to select which resource type to import
    When the user selects a resource type
    Then only resources of that type are extracted into the dataset

  # --- Plugin Processing Contract ---

  Scenario: Plugin output conforms to data lake format
    Given any file format plugin
    When the plugin processes a file
    Then it produces a tabular DataFrame with typed columns
    And the platform writes it as partitioned Parquet to the data lake
    And schema inference and column profiling run on the result
    And the dataset integrates with existing chat operations (filter, sort, add, delete)

  Scenario: Plugin can define custom schema mappings
    Given a plugin that provides explicit column type mappings
    When a file is processed
    Then the plugin's type mappings take precedence over default inference
    And the schema_config reflects the plugin-defined types

  Scenario: Plugin can define custom data cleaning rules
    Given a plugin that specifies cleaning transforms for its format
    When a file is processed
    Then the cleaning transforms are automatically applied to the new dataset
    And the transforms appear in the dataset's transform list

  # --- dbt Export Compatibility ---

  Scenario: Plugin-created datasets export correctly to dbt
    Given a dataset was created via the HL7v2 plugin
    When the user exports the project as a dbt project
    Then the dataset appears in sources.yml with correct storage paths
    And a staging model SQL file is generated for the dataset
    And the dbt project builds successfully against the parquet files

  Scenario: Plugin can contribute custom dbt macros
    Given a plugin defines custom dbt macros for its data domain
    When a dbt project is exported
    Then the plugin's macros are included in the macros/ directory
    And staging models can reference the custom macros

  # --- Error Handling ---

  Scenario: Plugin processing error is surfaced in chat
    Given a registered plugin
    When file processing fails due to malformed input
    Then the chat displays a user-friendly error from the plugin
    And the upload widget shows a "Retry" button
    And no partial dataset is created

  Scenario: Plugin validation rejects unsupported file content
    Given the HL7v2 plugin is registered
    When the user uploads a file with .hl7 extension but invalid HL7v2 content
    Then the plugin rejects the file with a descriptive validation error
    And the error is displayed in the chat

  # --- Chat Integration ---

  Scenario: User uploads via natural language
    Given plugins for Excel, HL7v2, and FHIR are registered
    When the user types "upload my patient data" in the chat
    Then the assistant asks what file they'd like to upload
    And the upload dialog opens with all supported formats available

  Scenario: Plugin provides format-specific chat guidance
    Given the FHIR plugin is registered
    When a FHIR dataset is created
    Then the assistant provides context-aware guidance about the data
    And suggests relevant operations (e.g., "filter by Patient resource fields")
