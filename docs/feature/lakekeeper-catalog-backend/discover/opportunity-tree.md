# Opportunity–Solution Tree — LakeKeeper as Catalog Backend (DC-139)

**Wave:** DISCOVER · **Status:** complete · **Date:** 2026-07-05

> Opportunities are framed as underserved *engineering needs* (brownfield
> analog of customer needs), each grounded in code/ADR evidence. Solutions are
> scored against the desired outcome and the ADR-026 hard invariant.

---

## Desired outcome (the root)

**A catalog-vs-query separation that is genuinely cleaner than today's, enables
easier schema evolution, and offers a standard external-access path — without
violating ADR-026 (operations-as-data, SQL always re-derived) or duplicating the
authoritative metadata store we already run.**

Measured by:
- No new read-back-authority surface introduced (ADR-026 invariant intact).
- Net reduction (not addition) in per-tenant provisioning surface (`[C4]`).
- A concrete external client served that Postgres-wire cannot serve today.

---

## Opportunities beneath the outcome

### O1 — Reduce the per-org/per-project BI provisioning surface `[REAL — see problem-validation P2]`
Evidence: `enable_sql_access.py:71-114`, `query_engine_provisioner.py:51-76`,
`008_add_query_engine_nodes.py:37-50`. Admin-credentialed engine nodes +
schema/role/view lifecycle + credential rotation + view sync per project.
**Underserved:** yes, this is real operational weight.

### O2 — Offer a standard, tool-agnostic external catalog protocol `[SPECULATIVE — no blocked client]`
Evidence: 0 matches for iceberg/rest-catalog; external access is Postgres-wire
only (`[C4]`). **Underserved:** unproven — no client is demonstrated to need a
non-Postgres protocol. Postgres-wire is itself universally supported.

### O3 — Manage table/schema/partition evolution with versioned metadata `[SPECULATIVE]`
Evidence: schema evolution today is operations-as-data (`transforms`, ADR-051;
`views/reports`, ADR-052). No demonstrated schema-versioning pain.
**Underserved:** no evidence of pain; ADR-051/052 already give reproducible,
sequenced, queryable evolution history in the operations tables.

### O4 — Reach a client-side (browser) query/preview path (DuckDB-WASM) `[ORTHOGONAL]`
Evidence: proposal hypothesis 4. **Underserved:** possibly, but this need is
**decoupled from LakeKeeper** — DuckDB-WASM reads Parquet/Iceberg directly and
needs no LakeKeeper catalog to exist. Pursuing O4 is not a reason to adopt
LakeKeeper.

**Prioritized:** O1 is the only opportunity that is both real and underserved.
O2/O3 are speculative; O4 is orthogonal. A solution should be judged primarily
on whether it serves O1 without breaking the outcome's ADR-026 constraint.

---

## Candidate solutions

### S-A — Full adopt: LakeKeeper becomes the catalog backend
LakeKeeper (Iceberg REST catalog + management core) replaces/fronts the Postgres
metadata store; storage migrates Parquet→Iceberg; management entities
(Projects/Roles/Namespaces/Warehouses) adopted.

- Serves O2/O3, partially O1. **Does not** serve the outcome's constraints:
  introduces a second/third metadata authority contending with `[C1]` and
  auth-proxy identity (Q6); Parquet→Iceberg is a full storage-format migration
  (Q5); creates a live catalog whose reflected state is a standing temptation to
  read back as authority (ADR-026 risk, Q1/Q2).
- **Score vs outcome: 2/10.** Large operational bet, contends with a working
  model, high ADR-026 exposure, serves mostly speculative opportunities.

### S-B — Front existing Postgres with LakeKeeper (catalog facade only)
Keep Parquet-on-S3 and the app's metadata store; run LakeKeeper as an Iceberg
REST *facade* over existing tables, as an *export sink* only. No storage-format
change; operations IR stays authoritative; LakeKeeper is downstream, never read
back.

- Serves O2 (standard protocol) at the cost of a new always-on service and a
  sync loop. Serves O1 **negatively** (adds surface). ADR-026-compatible *only*
  if strictly export-only (sink) — see Q1.
- **Score vs outcome: 4/10.** Compatible-if-disciplined, but pays a permanent
  operational tax to serve an opportunity (O2) with no demonstrated client.

### S-C — Spike only: bounded, time-boxed feasibility probe
A throwaway probe (behind a flag, non-prod) answering the two decision-critical
questions: (1) can LakeKeeper run purely as an import-time source / export sink
without any render-time read-back (ADR-026)? (2) is there a concrete
Iceberg-consuming client that Postgres-wire cannot serve? No migration, no
production service, no identity re-platforming.

- Serves *learning*, not an opportunity directly. Cheapest way to convert the
  speculative O2/O3 into evidence and to stress-test the ADR-026 boundary before
  any bet.
- **Score vs outcome (as a learning move): 7/10** — *only if* a triggering
  client requirement exists to justify even the spike.

### S-D — Decline (do nothing now); revisit on a concrete trigger
Keep the current architecture (`[C1]`–`[C4]`). Pursue O1 (the one real
opportunity) via cheaper, in-model means (e.g. reduce per-project provisioning
steps, pool engine nodes) if/when it becomes a priority — independent of
LakeKeeper. Revisit LakeKeeper only when a concrete Iceberg-consuming client or a
demonstrated schema-versioning pain appears.

- Serves the outcome's *constraints* perfectly (nothing broken, no new
  authority, no migration). Does not serve O2/O3 — which are unvalidated anyway.
- **Score vs outcome: 8/10** given current evidence; the outcome's own
  constraints (no new authority, no ADR-026 exposure, reduce not add surface)
  reward inaction over an unforced re-platforming bet.

---

## Tree summary

```
OUTCOME: cleaner catalog↔query split + easier evolution + standard access,
         WITHOUT breaking ADR-026 or duplicating the metadata store
├── O1 reduce BI provisioning surface        [REAL]        ← only real+underserved
│     ├── S-A full adopt        (adds surface, high risk)   2/10
│     ├── S-B facade sink       (adds surface)              4/10
│     ├── S-C spike             (learning only)             7/10*  *needs trigger
│     └── S-D decline + cheaper in-model O1 work            8/10
├── O2 standard catalog protocol             [SPECULATIVE — no client]
├── O3 versioned schema evolution            [SPECULATIVE — no pain]
└── O4 DuckDB-WASM client path               [ORTHOGONAL — no LakeKeeper needed]
```

**Selected direction:** **S-D (Decline now) as the default**, with **S-C
(bounded spike)** as the *conditional* alternative that unlocks only if a
concrete Iceberg-consuming client requirement is produced. **S-A and S-B are not
recommended** on current evidence. Rationale and trade-offs in
`wave-decisions.md`.
