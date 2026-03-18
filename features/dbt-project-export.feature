Feature: dbt Project Export
  As a user with a project containing datasets and transforms
  I can export the project as a dbt project zip file
  So that I can run transformations outside the dashboard in CI/CD or scheduled jobs

  Background:
    Given a project with datasets and transforms exists
    And the user is authenticated and has access to the project

  # --- Happy Path ---

  Scenario: Export a project with datasets
    Given the project has two datasets with transforms applied
    When the user requests a dbt project export
    Then a zip file is downloaded containing a valid dbt project structure
    And the zip contains "dbt_project.yml" at the root
    And the zip contains "profiles.yml" at the root
    And the zip contains "models/staging/sources.yml"
    And the zip contains "models/schema.yml"
    And the zip contains one "stg_{name}.sql" file per dataset in "models/staging/"
    And the zip contains a "README.md" at the root

  Scenario: Generated model SQL reflects transform pipeline
    Given a dataset has cleaning transforms, filter transforms, and alias transforms
    When the user exports the project as a dbt project
    Then the model SQL contains CTEs in the correct order
    And the first CTE selects from the dbt source macro
    And the second CTE applies cleaning operations
    And the third CTE applies filter conditions in a WHERE clause
    And the final SELECT applies column aliases

  Scenario: Schema.yml contains column definitions
    Given a dataset has columns defined in its schema configuration
    When the user exports the project as a dbt project
    Then the schema.yml includes each dataset as a model
    And each model lists its columns with names and mapped types

  Scenario: Sources.yml maps datasets to parquet paths
    Given the project has datasets stored as parquet files
    When the user exports the project as a dbt project
    Then each dataset appears as a source table in sources.yml
    And each source table includes its storage path
    And each source table includes the dashboard dataset ID as metadata

  Scenario: Profiles.yml uses env var placeholders
    When the user exports the project as a dbt project
    Then the profiles.yml contains S3 credential placeholders using dbt env_var syntax
    And no real credential values appear in the exported files

  # --- Transform Variations ---

  Scenario: Dataset with no transforms
    Given a dataset has no transforms applied
    When the user exports the project as a dbt project
    Then the model SQL is a passthrough selecting all columns from the source

  Scenario: Dataset with only filter transforms
    Given a dataset has only filter transforms applied
    When the user exports the project as a dbt project
    Then the model SQL has a source CTE and a filtered CTE with a WHERE clause
    And no cleaning CTE is present

  Scenario: Dataset with only cleaning transforms
    Given a dataset has only cleaning transforms applied
    When the user exports the project as a dbt project
    Then the model SQL has a source CTE and a cleaned CTE
    And no filter CTE is present

  Scenario: Dataset with alias transforms
    Given a dataset has column alias transforms applied
    When the user exports the project as a dbt project
    Then the final SELECT renames columns according to their aliases

  Scenario: Dataset with disabled transforms
    Given a dataset has both enabled and disabled transforms
    When the user exports the project as a dbt project
    Then only enabled transforms appear in the generated SQL
    And disabled transforms are excluded entirely

  # --- Edge Cases ---

  Scenario: Empty project with no datasets
    Given the project has no datasets
    When the user exports the project as a dbt project
    Then a valid dbt project skeleton is returned
    And the models directory is empty

  Scenario: Duplicate dataset names after snake_case conversion
    Given two datasets have names that produce the same snake_case value
    When the user exports the project as a dbt project
    Then each model file has a unique filename
    And a numeric suffix disambiguates the duplicate names

  Scenario: Dataset with no schema configuration
    Given a dataset has no columns defined in its schema configuration
    When the user exports the project as a dbt project
    Then the model SQL still generates correctly
    And the schema.yml omits column definitions for that dataset

  # --- Auth & Multi-tenancy ---

  Scenario: Unauthorized access to another org's project
    Given a project belongs to a different organization
    When the user requests a dbt project export for that project
    Then the request is rejected with 403 Forbidden

  Scenario: Export of a non-existent project
    When the user requests a dbt project export for a project that does not exist
    Then the request is rejected with 404 Not Found

  # --- File Format ---

  Scenario: Zip file has correct content disposition
    When the user exports the project as a dbt project
    Then the response content type is "application/zip"
    And the content disposition header specifies the project name with a "_dbt.zip" suffix

  Scenario: dbt_project.yml is valid
    When the user exports the project as a dbt project
    Then the dbt_project.yml contains the project name in snake_case
    And it references the matching profile name
    And the model paths point to "models/"
