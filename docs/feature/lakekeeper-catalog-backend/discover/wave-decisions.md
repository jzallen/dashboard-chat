# Wave Decisions — DISCOVER: LakeKeeper as Catalog Backend (DC-139)

**Wave:** DISCOVER · **Status:** complete · **Date:** 2026-07-05
**Feature dir:** `docs/feature/lakekeeper-catalog-backend/discover/`

> Records decisions, constraints, and validated/invalidated assumptions from the
> DISCOVER exploration, each with rationale + evidence source. Brownfield
> framing: evidence is `file:line` and ADR IDs, not interviews.

---

## Recommendation

> **⚠️ SUPERSEDED 2026-07-05 — see `buy-vs-build.md`.** The DECLINE below was a
> compile-plane-biased read: it let ADR-026 (which governs *only* the SQL
> compile/render plane) veto the entire proposal, and framed the exercise as
> "does LakeKeeper fit our current internals" instead of the buy-vs-build
> question the issue actually asks ("which load-bearing features are we
> reinventing that Iceberg/LakeKeeper already carry"). The corrected finding
> separates four planes and lands on a **scoped BUY** of the
> catalog/management/audit plane while keeping Ibis on the compile plane. The
> analysis below is retained for the record; `buy-vs-build.md` is authoritative.

**DECLINE now** as the default, with a **conditional bounded SPIKE** that unlocks
only if a concrete Iceberg-consuming client requirement is produced first.
**Do not ADOPT** on current evidence.

### Top 3 reasons

1. **ADR-026 (hard invariant) forbids LakeKeeper's core value mode.** Every
   ADR-compatible answer to the 7 open questions (`solution-testing.md`) confines
   LakeKeeper to an import-time-source / export-sink peripheral that must pass a
   determinism probe with the catalog *offline* (`adr-026...:73-95, 230-242`;
   `adr-051...:283-289`). A live, queryable catalog — the whole point of
   LakeKeeper — is precisely the forbidden render-time read-back.
2. **The proposal's justifications for LakeKeeper specifically don't hold.** The
   "disaggregate catalog from query" split largely already exists (the
   authoritative catalog is `[C1]`, not pg_duckdb; pg_duckdb is a serving
   surface — `problem-validation.md` P1). The one real pain (per-org BI
   provisioning, `[C4]`) is on the *tenancy* axis, which LakeKeeper does not
   address; and no client is blocked by the absent catalog protocol
   (0 iceberg/rest-catalog matches).
3. **Cost is strictly additive; value is mostly speculative.** LakeKeeper is a
   new always-on stateful service that removes nothing (pg_duckdb, engine nodes,
   provisioning, ibis→DuckDB all remain — `solution-testing.md` Q4/Q7), adds a
   dual-authority identity/tenancy sync burden (Q6), and would need a
   Parquet→Iceberg migration the proposal lists as a non-goal (Q5) — all to
   serve opportunities (standard protocol, versioned schema) with no demonstrated
   pain (`opportunity-tree.md` O2/O3), and against the codebase's ratified
   "no new runtime dependency" bias (`adr-026...:296`).

### The one condition that changes the answer

If a **named, concrete external client / requirement** appears that needs an
Iceberg REST catalog and that Postgres-wire cannot serve *at all* (the client
cannot connect over standard Postgres TCP/IP — not merely that it prefers an
Iceberg endpoint), then a **bounded,
flag-gated, non-prod SPIKE** (S-C) is warranted — scoped only to prove Gate G-A
(ADR-026 determinism probe passes with LakeKeeper offline) and Gate G-B
(per-tenant provisioning surface net-reduced), per `lean-canvas.md` §4. No
migration, no production service, no identity re-platforming in the spike.

---

## Decisions

- **[D1] Recommend DECLINE-now / conditional-SPIKE; do not ADOPT.**
  Rationale: single real pain is a poor fit; headline value is ADR-026-forbidden
  or unvalidated; cost strictly additive.
  Source: `problem-validation.md`, `solution-testing.md` Q1–Q7,
  `lean-canvas.md`.

- **[D2] If a spike proceeds, LakeKeeper is admissible ONLY as an
  import-time source or export sink — never a render-time authority.**
  Rationale: ADR-026 reproducibility invariant; render-time reflection is a
  violation. Source: `adr-026...:73-95, 230-242`; `solution-testing.md` Q1/Q2.

- **[D3] Query path stays ibis→DuckDB unchanged; no Iceberg query connector.**
  Rationale: path (a) risks a second substrate + render-time read-back
  (ADR-003/026 tension); path (b) leaves query path untouched. Source:
  `adr-003...:38-44`, `adr-007...:26`, `adr-026...:81-84`; `solution-testing.md` Q4.

- **[D4] Any catalog-backend work must not precede or entangle ADR-052 (`[P2]`)
  delivery.** Rationale: ADR-052 is designed-but-unbuilt and is the prerequisite
  for the View/Report M→IR→ibis reconciliation; introducing an Iceberg schema
  authority against a moving IR designs against `[P2]`. Source:
  `adr-052...` (Proposed); `[P2]` project (Backlog); `solution-testing.md` Q3.

- **[D5] Our metadata store (`[C1]`) and auth-proxy remain the sole authorities
  for catalog, identity, and tenancy.** LakeKeeper management entities are not
  adopted as authorities; at most mirrored. Source: `[C1]`, CLAUDE.md Auth;
  `solution-testing.md` Q6.

---

## Constraints (with evidence)

- **[K1] ADR-026 determinism is a HARD invariant.** SQL always re-derived from
  persisted operations; nothing read back as authority. `adr-026...:73-95,
  230-242`; `adr-051...:60-71`; `adr-052...:68-71`.
- **[K2] ibis is the ONLY SQL compiler; no parallel compilers / escape hatches.**
  `adr-026...:81-84, 146-150, 266-268`.
- **[K3] DuckDB/pg_duckdb is the ratified analytical engine.** `adr-003...:38-44`.
- **[K4] Authoritative catalog metadata lives in the app relational store, not
  the query engine.** `[C1]`; `001_initial_schema.py`, `repositories/metadata/`.
- **[K5] External BI access is Postgres-wire only today; no Iceberg/REST/OData.**
  `[C4]`; 0 iceberg/rest-catalog matches (verified this pass).
- **[K6] Codebase bias against new always-on runtime dependencies.**
  `adr-026...:296`; `adr-051...:248`; `adr-052...:245`.
- **[K7] Must remain compatible with the unbuilt ADR-052 `relation_*` IR.**
  `[P2]`; `adr-052...:83-105`.

---

## Validated assumptions (with confidence)

- **[VA1] pg_duckdb "fuses metadata+query" is mostly misattributed; the split
  largely already exists.** Confidence: HIGH. Catalog = `[C1]`; pg_duckdb =
  serving surface (`enable_sql_access.py:71-114`). `problem-validation.md` P1.
- **[VA2] Per-org/per-project BI provisioning is a real complexity pain.**
  Confidence: HIGH. `enable_sql_access.py:71-114`,
  `query_engine_provisioner.py:51-76`, `008_...:37-50`. `[C4]`.
- **[VA3] ADR-026 confines LakeKeeper to a peripheral import/export role.**
  Confidence: HIGH. `solution-testing.md` Q1/Q2/Q4 against `adr-026...`.
- **[VA4] Operational cost of LakeKeeper is strictly additive.** Confidence:
  HIGH. Nothing removed under ADR-compliant use (Q4/Q7).
- **[VA5] Ownership overlap creates a dual-authority sync burden.** Confidence:
  HIGH. `[C1]` + auth-proxy vs LakeKeeper management core (Q6).

## Invalidated assumptions (with evidence)

- **[IA1] "LakeKeeper disaggregates a fused metadata+query monolith."**
  INVALIDATED — the authoritative catalog is already separate from the query
  engine (`[C1]` vs `[C2]`); LakeKeeper *adds* a metadata authority, not
  removes one. `problem-validation.md` P1.
- **[IA2] "The Postgres-catalog / DuckDB-query split simplifies the BI story."**
  INVALIDATED — LakeKeeper adds provisioning/sync surface (Q6/Q7); it does not
  simplify the per-tenant access provisioning that is the actual BI weight.
- **[IA3] "Management entities can be adopted rather than reinvented (cheap
  extension)."** INVALIDATED — adoption is a re-platforming of identity onto a
  second authority contending with auth-proxy (Q6), not a free extension.
- **[IA4] "No standard catalog protocol" is a validated problem.** INVALIDATED
  as a *problem* — it is a true fact but no blocked client exists; Postgres-wire
  serves all current BI tools (`[C4]`). `problem-validation.md` P3.
- **[IA5] "DuckDB-WASM benefit requires LakeKeeper."** INVALIDATED — DuckDB-WASM
  reads Parquet/Iceberg directly; the client-side path is orthogonal to adopting
  LakeKeeper (`opportunity-tree.md` O4).

---

## Open items handed forward

- **[OF1] Produce or reject the trigger.** Before any spike: name a concrete
  Iceberg-consuming client Postgres-wire cannot serve, or record that none
  exists and DECLINE stands.
- **[OF2] If O1 (BI provisioning weight) is a priority, pursue it in-model**
  (pool/reuse engine nodes, reduce provisioning steps) independent of LakeKeeper.
- **[OF3] Revisit only after ADR-052 lands** to avoid designing against a moving
  IR (`[P2]`, D4).
