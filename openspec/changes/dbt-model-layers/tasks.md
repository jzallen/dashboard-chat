## Phase 1: Views (Intermediate Layer)

### 1. Database & ORM

- [x] 1.1 Create Alembic migration adding `views` table with all columns from design D8 (id, project_id, org_id, name, description, sql_definition, source_refs, materialization, created_at, updated_at)
- [x] 1.2 Create `ViewRecord` ORM class in `backend/app/repositories/metadata/view_record.py` following `DatasetRecord` pattern
- [x] 1.3 Register `ViewRecord` in `backend/app/repositories/metadata/__init__.py`

### 2. Domain Model

- [x] 2.1 Create `View` domain model in `backend/app/models/view.py` as frozen dataclass with `from_record`, `serialize` methods
- [x] 2.2 Add `View` export in `backend/app/models/__init__.py`
- [x] 2.3 Write unit tests for `View` domain model (construction, serialization, from_record)

### 3. Repository

- [x] 3.1 Add View CRUD methods to `MetadataRepository` (create_view, get_view, list_views_by_project, update_view, delete_view)
- [x] 3.2 Write repository tests for View CRUD operations

### 4. Dependency Tracking

- [x] 4.1 Create `backend/app/use_cases/view/dependency_service.py` with source reference validation (check referenced IDs exist in same project)
- [x] 4.2 Add circular dependency detection via DFS traversal of source_refs graph
- [x] 4.3 Write tests for reference validation (valid refs, missing refs, cross-project refs)
- [x] 4.4 Write tests for circular dependency detection (direct cycle, transitive cycle, diamond OK)

### 5. Use Cases

- [x] 5.1 Create `backend/app/use_cases/view/create_view.py` with `@with_repositories` + `@handle_returns`, calling dependency validation
- [x] 5.2 Create `backend/app/use_cases/view/get_view.py` and `list_views.py`
- [x] 5.3 Create `backend/app/use_cases/view/update_view.py` with dependency re-validation on source_refs change
- [x] 5.4 Create `backend/app/use_cases/view/delete_view.py`
- [x] 5.5 Write use case tests for all View CRUD operations

### 6. Router & Controller

- [x] 6.1 Create `backend/app/routers/views.py` with POST/GET/PATCH/DELETE endpoints under `/api/projects/{project_id}/views`
- [x] 6.2 Add View routes to controller delegation in `backend/app/controllers/http_controller.py`
- [x] 6.3 Mount view router in `backend/app/main.py`
- [x] 6.4 Write integration tests for View API endpoints (CRUD, auth, org scoping)

### 7. dbt Export — Intermediate Layer

- [x] 7.1 Create `backend/app/use_cases/project/_dbt/intermediate.py` for generating `int_*.sql` files with config block and `{{ ref() }}` resolution
- [x] 7.2 Modify `export_dbt_project.py` to query Views and include intermediate models in zip
- [x] 7.3 Add `models/intermediate/` directory to zip generation in `generate_dbt_project_zip`
- [x] 7.4 Add broken reference detection — fail export with clear error if source_ref points to deleted entity
- [x] 7.5 Write tests for intermediate model SQL generation (config block, ref() calls, materialization)
- [x] 7.6 Write tests for export with Views (zip contains intermediate dir, correct filenames)

## Phase 2: Reports (Mart Layer)

### 8. Database & ORM

- [x] 8.1 Create Alembic migration adding `reports` table with all columns from design D8 (includes report_type, domain, columns_metadata)
- [x] 8.2 Create `ReportRecord` ORM class in `backend/app/repositories/metadata/report_record.py`
- [x] 8.3 Register `ReportRecord` in `backend/app/repositories/metadata/__init__.py`

### 9. Domain Model

- [x] 9.1 Create `Report` domain model in `backend/app/models/report.py` with `report_type`, `domain`, `columns_metadata` fields
- [x] 9.2 Add `Report` export in `backend/app/models/__init__.py`
- [x] 9.3 Write unit tests for `Report` domain model

### 10. Column Metadata Validation

- [x] 10.1 Create `backend/app/use_cases/report/column_validation.py` — validate semantic_role/semantic_type pairs, time_granularity requirement
- [x] 10.2 Write tests for column metadata validation (valid combos, invalid combos, missing time_granularity, empty metadata)

### 11. Repository & Use Cases

- [x] 11.1 Add Report CRUD methods to `MetadataRepository` (create_report, get_report, list_reports_by_project, update_report, delete_report)
- [x] 11.2 Create Report use cases: create, get, list, update, delete — reusing dependency_service from phase 1
- [x] 11.3 Integrate column metadata validation into create/update use cases
- [x] 11.4 Write repository and use case tests for Report CRUD

### 12. Router & Controller

- [x] 12.1 Create `backend/app/routers/reports.py` with POST/GET/PATCH/DELETE endpoints under `/api/projects/{project_id}/reports`
- [x] 12.2 Add Report routes to controller and mount in main.py
- [x] 12.3 Write integration tests for Report API endpoints

### 13. dbt Export — Mart Layer

- [x] 13.1 Create `backend/app/use_cases/project/_dbt/marts.py` for generating `fct_*.sql` / `dim_*.sql` files with domain subdirectories
- [x] 13.2 Modify export to include mart models in zip under `models/marts/{domain_snake}/`
- [x] 13.3 Extend `schema.yml` generation to include mart models with semantic column metadata in `meta` sections
- [x] 13.4 Write tests for mart model SQL generation (fct/dim prefix, domain dirs, ref() calls)
- [x] 13.5 Write tests for schema.yml with semantic metadata (roles, types, time_granularity)

## Phase 3: Chat Integration

### 14. Layer-Specific Prompts

- [x] 14.1 Add intermediate-layer operation allowlist to chat system prompt template in `shared/chat/`
- [x] 14.2 Add mart-layer operation allowlist to chat system prompt template
- [x] 14.3 Add layer context injection (current model name + layer) to system prompt construction
- [x] 14.4 Add guidance responses for out-of-layer operations (e.g., "aggregations belong in a View")
- [x] 14.5 Write tests for prompt generation with different layer contexts

### 15. Frontend — Context Awareness

- [x] 15.1 Add View and Report types to frontend API client (`frontend/src/lib/api/`)
- [x] 15.2 Add TanStack Query hooks for View and Report CRUD (query keys, mutations)
- [x] 15.3 Add layer context indicator badge to chat panel showing current model name and layer
- [x] 15.4 Update SideNav to display Views and Reports alongside Datasets in project navigation
- [x] 15.5 Update data catalog to show layer type distinction (Dataset/View/Report) with visual indicators
