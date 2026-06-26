# Shared Artifacts Registry — transform-operations-ir

Every artifact passed between journey steps, with its **single** source of truth.
The governing rule (ADR-051 hard invariant): **operations are the only durable
authority; ibis/SQL are always derived and never read back.**

| Artifact (`${...}`) | Single source of truth | Owner / writer | Derived? | Consumers | Notes |
|---|---|---|---|---|---|
| `${operations_list}` | `transforms` table (canonical, sequenced rows) | Operation Validator + `create_transforms` / `update_transforms` | No | ibis renderer, display renderer, dbt eject, dedup path | The authority. M parser and direct authoring are the only writers. |
| `${sequence}` | per-dataset integer assigned at write time | Transform use cases (write path) | No | loaders (`order_by(sequence)`), ibis renderer | Gap-tolerant integers (resolve formula in DISTILL/DELIVER). Replaces `created_at` ordering at `dataset_sql.py:104-107`, `repository.py:619`. |
| `${operation_ibis_args}` | `operation_ibis_args` sparse sidecar (≤1 row/op) | ibis render boundary | No | ibis renderer (left-join) | Internal-only; never in `Transform.serialize()` (`transform.py:71-84`). Absent ⇒ render neutral op faithfully. |
| `${operation_m_args}` | `operation_m_args` sparse sidecar (≤1 row/op) | M render boundary | No | M renderer (deferred, outbound) | Internal-only; never customer-facing. |
| `${dispatch_catalog}` | single code catalog keyed by operation discriminator | renderer module (collapse of `types.py:120-267`) | No | ibis / display / M visitors; completeness probe | One entry per operation carries validate + render closures. |
| `${ibis_table}` | output of `dataset_sql.build_ibis_table` | ibis renderer | **Yes** | ibis SQL compiler | Pure function of `${operations_list}` + `${sequence}` + sidecars. |
| `${staging_sql}` | ibis SQL compilation | ibis (ADR-007/026) | **Yes** | DuckDB preview, dbt eject | Never stored as authority, never read back. |
| `${validated_operation}` | Pydantic discriminated union instance | boundary validator | No (transient) | persistence | Exists only at the boundary; rejected operations produce a structured error, not a row. |

## Single-source check

- ✅ Every artifact has exactly one writer/owner.
- ✅ Ordering has one source (`${sequence}`), not two (`created_at` is demoted to provenance).
- ✅ Target-specific shaping lives only in the per-target sidecars, never in `${operations_list}`.
- ✅ All derived artifacts (`${ibis_table}`, `${staging_sql}`) flow strictly outbound.

## Cross-journey hand-offs

- **Into J-001/J-002 scope:** the operations list is scoped per dataset, itself
  scoped by `org_id` (multi-tenancy). No new tenancy artifact introduced.
- **Into JOB-001 (eject validation):** `${staging_sql}` determinism is the
  property JOB-001's cross-eject assertions rely on.
