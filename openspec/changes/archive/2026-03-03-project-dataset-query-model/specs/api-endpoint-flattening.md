# Capability: API Endpoint Flattening

**Status**: MODIFIED
**Domain**: backend (API, use cases, repository)

## Overview

Flatten the Project → Dataset API so that projects and datasets are fetched independently. Remove nested dataset loading from the project endpoint, add a dedicated datasets-for-project endpoint, and replace the N+1 `fetch_full_datasets` pattern with single-query repository methods.

---

## MODIFIED Requirements

### Requirement: Project Endpoint Returns Project Only

The `GET /api/projects/:id` endpoint SHALL return project metadata without nested datasets.

- The `include_datasets` query parameter SHALL be removed from the router.
- The `include_datasets` parameter SHALL be removed from the `get_project` use case.
- `ProjectService.fetch_and_authorize_project()` SHALL always return project metadata only (its default `include_datasets=False` becomes the only behavior).
- The response shape SHALL be `{ id, name, description, org_id, created_at, updated_at }` with no `datasets` field.

#### Scenario: Get project returns metadata only

- **WHEN** a client sends `GET /api/projects/:id`
- **THEN** the response SHALL contain project metadata fields (`id`, `name`, `description`, `org_id`, `created_at`, `updated_at`)
- **THEN** the response SHALL NOT contain a `datasets` field

#### Scenario: include_datasets query parameter is no longer accepted

- **WHEN** a client sends `GET /api/projects/:id?include_datasets=true`
- **THEN** the server SHALL ignore the unknown parameter (no error, no datasets in response)

---

### Requirement: Dedicated Datasets-for-Project Endpoint

A new `GET /api/projects/:id/datasets` endpoint SHALL return sparse dataset references for a project.

- The endpoint SHALL return an array of sparse dataset objects: `{ id, name, link, description, row_count, schema_config }`.
- The endpoint SHALL NOT include transforms in the response.
- The endpoint SHALL verify org_id access via the existing `ProjectService.fetch_and_authorize_project()` pattern (project must exist and belong to user's org).
- The endpoint SHALL return 404 if the project does not exist.
- The endpoint SHALL return 403 if the user's org does not own the project.

#### Scenario: List datasets for a project

- **WHEN** a client sends `GET /api/projects/:id/datasets` for a project with 3 datasets
- **THEN** the response SHALL be an array of 3 sparse dataset objects
- **THEN** each object SHALL contain `id`, `name`, `link`, `description`, `schema_config`
- **THEN** no object SHALL contain `transforms`, `preview_rows`, or `staging_sql`

#### Scenario: List datasets for empty project

- **WHEN** a client sends `GET /api/projects/:id/datasets` for a project with 0 datasets
- **THEN** the response SHALL be an empty array `[]`

#### Scenario: List datasets for nonexistent project

- **WHEN** a client sends `GET /api/projects/:id/datasets` for a nonexistent project ID
- **THEN** the response SHALL be 404

#### Scenario: List datasets with wrong org

- **WHEN** a client from org A sends `GET /api/projects/:id/datasets` for a project owned by org B
- **THEN** the response SHALL be 403

---

### Requirement: Repository Method with Optional Transform Loading

The existing `MetadataRepository.list_datasets(project_id)` SHALL support optional transform loading via an `include_transforms` parameter.

- When `include_transforms=True` (current default behavior), the method SHALL use `selectinload(DatasetRecord.transforms)` to load transforms in a single query.
- When `include_transforms=False`, the method SHALL NOT load transforms.
- The method continues to return `DatasetRecord` ORM objects.
- The API path SHALL call with `include_transforms=False`.
- Internal callers (SQL access, dbt export) SHALL call with `include_transforms=True`.

#### Scenario: List datasets without transforms (API path)

- **WHEN** `list_datasets(project_id, include_transforms=False)` is called
- **THEN** the query SHALL NOT include `selectinload(DatasetRecord.transforms)`
- **THEN** the returned records SHALL NOT have transforms eagerly loaded

#### Scenario: List datasets with transforms (internal path)

- **WHEN** `list_datasets(project_id, include_transforms=True)` is called
- **THEN** the query SHALL use `selectinload(DatasetRecord.transforms)` filtering out deleted transforms
- **THEN** the returned records SHALL have transforms accessible without additional queries

---

### Requirement: Eliminate fetch_full_datasets N+1 Pattern

Both `ProjectService.fetch_full_datasets()` and `sql_access_service.fetch_full_datasets()` SHALL be removed. All callers SHALL use `MetadataRepository.list_datasets(project_id, include_transforms=True)` followed by `Dataset.from_record()` conversion.

- `ProjectService.fetch_full_datasets()` SHALL be removed from `project_service.py`.
- `sql_access_service.fetch_full_datasets()` (the standalone function) SHALL be removed from `sql_access_service.py`.
- `export_dbt_project.py` SHALL call `repositories.metadata.list_datasets(project_id, include_transforms=True)` and convert to domain objects.
- `enable_sql_access.py` SHALL use the same pattern.
- `sync_sql_access.py` SHALL use the same pattern.
- `provision_and_bootstrap_environment()` in `sql_access_service.py` SHALL use the same pattern.
- The intermediate step of fetching a project with sparse datasets and then re-fetching each dataset SHALL be eliminated.

#### Scenario: SQL access provisioning loads datasets in one query

- **WHEN** `enable_sql_access` provisions SQL views for a project with 5 datasets
- **THEN** the system SHALL execute a single query to load all 5 datasets with transforms
- **THEN** the system SHALL NOT execute 5 additional individual dataset queries

#### Scenario: dbt export loads datasets in one query

- **WHEN** `export_dbt_project` generates a dbt project for a project with 5 datasets
- **THEN** the system SHALL execute a single query to load all 5 datasets with transforms
- **THEN** the system SHALL NOT execute 5 additional individual dataset queries

---

### Requirement: Remove Dead include_transforms Parameter

The `include_transforms` parameter on the `get_dataset` use case SHALL be removed since it is never used by callers (the use case always loads transforms).

- The use case function signature SHALL not include `include_transforms`.
- The underlying `get_dataset` and `get_dataset_record` repository methods retain their `include_transforms` parameter (it's used by the repository internally).
- No behavior change — the use case always returns a dataset with transforms.

#### Scenario: get_dataset always returns transforms

- **WHEN** a client calls `GET /api/datasets/:id`
- **THEN** the response SHALL include the `transforms` array (unchanged from current behavior)
