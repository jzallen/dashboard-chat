<!-- DES-ENFORCEMENT : exempt -->
# C4 Diagrams — Metadata Repository Split

## L3 Component — Current state

One class, eight aggregates, 35+ methods. Use cases bind to a single facade.

```mermaid
C4Component
  title Component (current) — backend repository layer
  Container_Boundary(uc, "Use cases (app/use_cases/*)") {
    Component(uc_dataset, "Dataset use cases", "Python", "create / list / update / delete dataset, transforms")
    Component(uc_project, "Project use cases", "Python", "CRUD + dbt export")
    Component(uc_session, "Session use cases", "Python", "create / list / replay")
    Component(uc_view, "View / Report use cases", "Python", "CRUD + dependency service")
    Component(uc_org, "Organization use cases", "Python", "create / get")
  }
  Container_Boundary(repo, "app/repositories") {
    Component(container, "RepositoryContainer", "Python", "Lazy DI container; .metadata property")
    Component(metarepo, "MetadataRepository", "Python — 866 LOC, 35+ methods, 8 aggregates", "ALL aggregate persistence")
    Component(restricted, "RestrictedSession", "Python", "Wraps AsyncSession; no commit/rollback")
  }
  ComponentDb(db, "PostgreSQL / SQLite", "SQLAlchemy 2.0 async", "Stores all aggregates")
  Rel(uc_dataset, container, "asks for", ".metadata")
  Rel(uc_project, container, "asks for", ".metadata")
  Rel(uc_session, container, "asks for", ".metadata")
  Rel(uc_view, container, "asks for", ".metadata")
  Rel(uc_org, container, "asks for", ".metadata")
  Rel(container, metarepo, "lazily constructs")
  Rel(metarepo, restricted, "executes through")
  Rel(restricted, db, "issues SQL against")
```

## L3 Component — Proposed (Phase A — facade in place)

Eight per-aggregate repositories register with the container; the facade preserves the legacy `.metadata` surface during migration.

```mermaid
C4Component
  title Component (proposed, Phase A) — per-aggregate split with transitional facade
  Container_Boundary(uc, "Use cases (app/use_cases/*)") {
    Component(uc_dataset, "Dataset use cases", "Python", "")
    Component(uc_project, "Project use cases", "Python", "")
    Component(uc_session, "Session use cases", "Python", "")
    Component(uc_view, "View use cases", "Python", "")
    Component(uc_report, "Report use cases", "Python", "")
    Component(uc_org, "Organization use cases", "Python", "")
  }
  Container_Boundary(repo, "app/repositories/metadata") {
    Component(container, "RepositoryContainer", "Python", ".projects / .datasets / .transforms / .sessions / .views / .reports / .organizations / .project_memories")
    Component(facade, "_LegacyMetadataFacade", "Python — DEPRECATED", "Delegates 35-method legacy surface to the eight repos; emits DeprecationWarning")
    Component(r_project, "ProjectRepository", "Python ~120 LOC", "")
    Component(r_dataset, "DatasetRepository", "Python ~150 LOC", "")
    Component(r_transform, "TransformRepository", "Python ~140 LOC", "")
    Component(r_session, "SessionRepository", "Python ~120 LOC", "")
    Component(r_view, "ViewRepository", "Python ~100 LOC", "")
    Component(r_report, "ReportRepository", "Python ~100 LOC", "")
    Component(r_org, "OrganizationRepository", "Python ~50 LOC", "")
    Component(r_pmem, "ProjectMemoryRepository", "Python ~50 LOC", "")
    Component(restricted, "RestrictedSession", "Python", "Reused as-is")
    Component(decorators, "_base.handle_repository_exceptions", "Python", "Reused as-is, lifted to shared module")
  }
  ComponentDb(db, "PostgreSQL / SQLite", "SQLAlchemy 2.0 async", "")
  Rel(uc_dataset, container, "asks for", ".datasets / .transforms")
  Rel(uc_project, container, "asks for", ".projects")
  Rel(uc_session, container, "asks for", ".sessions")
  Rel(uc_view, container, "asks for", ".views")
  Rel(uc_report, container, "asks for", ".reports")
  Rel(uc_org, container, "asks for", ".organizations")
  Rel(container, facade, "exposes via .metadata (deprecated)")
  Rel(facade, r_project, "delegates to")
  Rel(facade, r_dataset, "delegates to")
  Rel(facade, r_transform, "delegates to")
  Rel(facade, r_session, "delegates to")
  Rel(facade, r_view, "delegates to")
  Rel(facade, r_report, "delegates to")
  Rel(facade, r_org, "delegates to")
  Rel(facade, r_pmem, "delegates to")
  Rel(container, r_project, "lazily constructs")
  Rel(container, r_dataset, "lazily constructs")
  Rel(r_project, restricted, "executes through")
  Rel(r_dataset, restricted, "executes through")
  Rel(r_transform, restricted, "executes through")
  Rel(r_session, restricted, "executes through")
  Rel(r_view, restricted, "executes through")
  Rel(r_report, restricted, "executes through")
  Rel(r_org, restricted, "executes through")
  Rel(r_pmem, restricted, "executes through")
  Rel(restricted, db, "issues SQL against")
```

## L3 Component — Terminal (Phase C — facade removed)

Same as Phase A minus `_LegacyMetadataFacade` and the `.metadata` property. The `pytest-archon` rule promotes from warn to error: any new use case that imports the legacy facade fails CI.

## Sequence — `create_dataset_from_upload` (representative)

Shows the new container-property access path. The use case touches two aggregates (Dataset, Project for existence check) plus the lake; this surfaces the multi-aggregate access pattern that justified one-class-per-aggregate over β grouping.

```mermaid
sequenceDiagram
    autonumber
    participant Client as Router (POST /upload/{id}/datasets)
    participant UC as create_dataset_from_upload<br/>@with_repositories
    participant Container as RepositoryContainer
    participant ProjectRepo as ProjectRepository
    participant DatasetRepo as DatasetRepository
    participant LakeRepo as MinIOLakeRepository
    participant DB as RestrictedSession
    participant PG as PostgreSQL

    Client->>UC: invoke(upload_id, partition_fields)
    UC->>Container: ask for .projects
    Container->>ProjectRepo: lazily construct(RestrictedSession)
    UC->>ProjectRepo: project_exists(project_id)
    ProjectRepo->>DB: execute(select exists ...)
    DB->>PG: SELECT exists(...)
    PG-->>DB: true
    DB-->>ProjectRepo: true
    ProjectRepo-->>UC: true
    UC->>Container: ask for .datasets
    Container->>DatasetRepo: lazily construct(RestrictedSession)
    UC->>DatasetRepo: create_dataset(project_id, name, schema_config, ...)
    DatasetRepo->>DB: add(DatasetRecord) + flush + refresh
    DB->>PG: INSERT ... RETURNING id, storage_path
    PG-->>DB: row
    DB-->>DatasetRepo: refreshed record
    DatasetRepo-->>UC: dataset dict
    UC->>LakeRepo: write_parquet(df, dataset, partition_fields)
    LakeRepo-->>UC: ok
    UC-->>Client: Success(dataset)
    Note over UC,DB: @with_repositories commits the transaction on return.<br/>Org-scoping enforcement happened at the router boundary (unchanged).
```
