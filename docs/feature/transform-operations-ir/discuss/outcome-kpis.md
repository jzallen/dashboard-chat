# Outcome KPIs — transform-operations-ir

**Wave:** DISCUSS · **Job:** JOB-003 · Hand-off to DEVOPS (instrumentation) + DESIGN (already done).

KPIs are framed as outcomes (JOB-003 under-served outcomes first), each with a
numeric target and a measurement method. Because this is a backend correctness
feature, most targets are **invariants measured by tests/probes** rather than
runtime telemetry — the probe pass-rate *is* the KPI.

| KPI | JOB-003 outcome | Numeric target | Measurement method |
|---|---|---|---|
| **K1 — Render determinism** | O1 | 100% of persisted operation lists compile to byte-identical SQL across repeated compilations and a load→recompile round-trip | Reproducibility probe (DELIVER): `compile(ops) == compile(load_and_recompile(ops))`, run continuously in CI over a production-derived corpus |
| **K2 — Order fidelity** | O1 | 0 datasets whose backfilled `sequence` changes their previously-rendered SQL | Slice-01 AC2 golden test over production datasets; count of diffs must be 0 (any diff is triaged, not silenced) |
| **K3 — No silent degrade** | O2 | 0 malformed operations persisted; 100% rejected at the boundary with a structured error | Slice-02 acceptance tests; assert no `-- Error generating SQL` reachable for validated operations |
| **K4 — Renderer completeness** | O3 | 100% of operation discriminators handled by 100% of active visitors; build fails otherwise | Renderer-completeness probe (Slice 03), enforced in CI; negative test proves a missing entry fails the build |
| **K5 — Sidecar sparseness** | O4 | <10% of operations require a sidecar row (sparseness assumption); 0 dialect args in customer-facing serialization | Count sidecar rows / total operations on a production corpus (Slice 04); assert `Transform.serialize()` contains no sidecar fields |
| **K6 — Import faithfulness** | O5 | 100% of out-of-vocabulary M constructs rejected by name with 0 partial imports; 100% of supported-subset imports preserve script order | Slice-05 acceptance tests (AC5.1–AC5.4) |
| **K7 — Cost to extend** | O3 | Adding a new operation touches exactly 1 catalog entry (not 3 methods); adding a render target = 1 new visitor | Review checklist + diff inspection on the first post-catalog operation/target added |

## Leading indicators (track during DELIVER)

- Number of operation discriminators with a complete catalog entry (should reach
  parity with the vocabulary before Slice 03 closes).
- Backfill dry-run diff count on staging data (K2 leading indicator before the
  migration lands).

## Non-KPI guardrails (must-not-regress)

- Existing dbt-staging row-equivalence tests stay green (ADR-026 MR-5 precedent).
- No new runtime dependency (ADR-051 Operational: ibis already ratified).
- Multi-tenancy: operations remain dataset-scoped under `org_id`.
