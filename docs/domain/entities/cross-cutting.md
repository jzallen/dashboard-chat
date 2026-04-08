# Cross-Cutting Rules

## Authorization Model

| Resource | Operation | Who Can Access | Enforcement |
|:---------|:----------|:---------------|:------------|
| Project | read/write | Users where `user.org_id == project.org_id` | `deps.py:authorize_project_access()` |
| Dataset | read/write | Users where `user.org_id == dataset.project.org_id` | `deps.py:authorize_dataset_access()` |
| View | read/write | Users where `user.org_id == view.org_id` | Router-level via project authorization |
| Report | read/write | Users where `user.org_id == report.org_id` | Router-level via project authorization |
| Session | read | Any user in the org | No owner check on `list_sessions` |
| Session | write | Session owner only (`user.id == session.owner_id`) | `update_session.py` raises `SessionAccessDenied` |
| Organization | create | Any authenticated user (even without org) | `ORG_LESS_PATHS` in auth middleware |

**Enforced in:** `backend/app/routers/deps.py`, `backend/app/auth/middleware.py`
**Specified in:** `openspec/specs/session-ownership/spec.md` (session only), `openspec/specs/router-layer-authorization/spec.md`

## Multi-Tenancy

> All data queries SHALL be scoped by `org_id` via `RestrictedSession`.

**Enforced in:** `backend/app/repositories/metadata/repository.py` — RestrictedSession appends `WHERE org_id = ?` to all queries
**Specified in:** `docs/architecture/backend-layers.md`, `../../requirements/nfr.md` (NFR-MT1)

## Domain Exception Catalog

All domain exceptions inherit from `DomainException` and carry `_type`, `_title`, and `_status_code`:

| Exception | Status | Domain |
|:----------|:------:|:-------|
| `ProjectNotFound` | 404 | Project |
| `ProjectIdRequired` | 400 | Project |
| `ProjectHasNoDatasets` | 400 | Project |
| `ExportValidationError` | 400 | Project |
| `DatasetNotFound` | 404 | Dataset |
| `InvalidExpressionConfig` | 400 | Dataset |
| `ColumnTypeMismatch` | 422 | Dataset |
| `PreviewNotSupported` | 400 | Dataset |
| `ViewNotFound` | 404 | View |
| `InvalidSourceReference` | 400 | View |
| `CircularDependency` | 400 | View |
| `ReportNotFound` | 404 | Report |
| `InvalidReportReference` | 400 | Report |
| `InvalidColumnMetadata` | 400 | Report |
| `UploadNotFound` | 404 | Upload |
| `UploadAlreadyProcessed` | 409 | Upload |
| `InvalidFileType` | 400 | Upload |
| `UnsupportedFormat` | 400 | Upload |
| `EmptyFile` | 400 | Upload |
| `SessionNotFound` | 404 | Session |
| `SessionAccessDenied` | 403 | Session |
| `SqlAccessAlreadyEnabled` | 409 | SQL Access |
| `SqlAccessNotEnabled` | 404 | SQL Access |
| `CredentialCooldown` | 429 | SQL Access |
| `QueryEngineUnreachable` | 502 | SQL Access |
| `PluginValidationError` | 400 | Upload |
| `ExternalServiceError` | 502 | Organization |

**Enforced in:** `backend/app/use_cases/*/exceptions.py`
**Specified in:** Undocumented (code-only)

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
