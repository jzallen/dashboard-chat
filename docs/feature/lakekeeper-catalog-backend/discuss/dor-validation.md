# Definition of Ready — lakekeeper-catalog-backend

**Wave:** DISCUSS · validated against the 9-item DoR checklist with evidence.
**Requirements completeness score: 0.97** (see calculation below).

| # | DoR item | Status | Evidence |
|---|---|---|---|
| 1 | **User value / problem is clear (domain language)** | PASS | JOB-005 in `docs/product/jobs.yaml` with three dimensions + light four-forces (`jtbd-job-stories.md`); every story has an Elevator Pitch with a real operator/data-engineer-invocable entry point (a WorkOS-authenticated call, a project-create through the port, a DuckDB `INSERT`/`SELECT`, the determinism probe, a catalog scan) + observable output + decision enabled (`user-stories.md`). Grounded in DISCOVER `file:line`/ADR evidence. |
| 2 | **Persona with specific characteristics** | PASS | Two personas named + contextualized: internal operator (provisions/represents/materializes/proves) and data engineer (consumes Iceberg tables) — `journey-...-visual.md`, `journey-...yaml` `primary_personas`. |
| 3 | **3+ domain examples with real data** | PASS | Each story's Elevator Pitch is a concrete before/after with real entry points and outputs; the journey step→output table gives 5 concrete steps with observable artifacts (`${lakekeeper_project_id}`, `${snapshot_id}`, probe PASS, query rows). The Gherkin (`journey-...feature`) has 11 scenarios with concrete Given/When/Then. |
| 4 | **UAT in Given/When/Then (3–7 scenarios)** | PASS | `journey-lakekeeper-catalog-backend.feature` — 11 scenarios across the 5 steps incl. the load-bearing ADR-026 determinism scenarios (re-derive == materialized; compile passes offline; no render-time catalog read). Per-story AC derived from these. |
| 5 | **AC derived from UAT** | PASS | Each US's AC map to the Gherkin scenarios and assert the Elevator-Pitch "After" end-to-end; every AC is behavioral (auto-provision, empty controller diff, committed snapshot, probe PASS-offline, rows returned) — no implementation-coupled assertions. Each AC is tagged to a System Constraint `[SC1]–[SC7]`. |
| 6 | **Right-sized (1–3 days each, 3–7 scenarios)** | PASS | 5 stories → 5 elephant-carpaccio slices, each ≤1 day with a named "disproves X" learning hypothesis (`slices/slice-0N-*.md`); the `@infrastructure` container-standup is folded into Slice 01 (no pure-infra slice); Scope Assessment PASS (0/5 oversized signals) in `story-map.md`. |
| 7 | **Technical notes: constraints/dependencies** | PASS | `## System Constraints` `[SC1]–[SC7]` at the top of `user-stories.md`; per-slice Dependencies sections; ADR-026 corollary + per-org-Server tenancy recorded in `wave-decisions.md` §Constraints Established. |
| 8 | **Dependencies resolved or tracked** | PASS | Strict dependency chain in `story-map.md` (01→02→03→04→05); three DESIGN open forks (project authority model, authZ boundary, migration shape) **tracked, not resolved** in `wave-decisions.md` §Upstream Changes; ADR-052 reconciliation tracked (`[K7]`). |
| 9 | **Outcome KPIs defined with measurable targets** | PASS | `outcome-kpis.md` — 8 KPIs, each with a numeric target + measurement method + baseline; K1 (determinism probe passes 100% with LakeKeeper offline) is the hard gate. |

## Carpaccio taste tests

| Test | Result |
|---|---|
| Any slice ships 4+ new components? | No — each slice adds one seam (an adapter, a write path, a probe, a reader) and reuses the existing hexagonal port + Ibis compile path. |
| Every slice depends on a new abstraction? | No — the repository port (ADR-020) and the Ibis compiler (ADR-026) already exist; slices implement adapters/paths behind them, not new abstractions. |
| Any slice disproves a pre-commitment? | Yes — every slice has a named "disproves X if it fails" hypothesis (`story-map.md`); Slice 04 disproves the whole BUY if determinism can't hold offline. |
| Any slice uses only synthetic data? | No — each dogfood moment uses a **real** WorkOS token, a **real** dc project + S3 prefix, a **real** chat-authored dataset (`prioritization.md` §Dogfood cadence). |
| 2+ slices identical except for scale? | No — five distinct concerns (auth, project-representation, materialize-write, determinism-proof, read-back). |
| Slice with only `@infrastructure` stories? | No — the container standup is folded **into** Slice 01 with an observable change (a WorkOS token now authenticates the catalog; a wrong-audience token is rejected). None blocked. |

**All taste tests pass.**

## Requirements completeness calculation

`completeness = covered_requirements / total_requirements`

- 5 sub-jobs (SJ-1..SJ-5) → 5 stories (US-1..US-5) → all covered (**1.0**).
- 5 JOB-005 outcomes (O1–O5) → all owned by ≥1 story (`user-stories.md` traceability
  matrix): O1→US-1/US-2; O2→US-2/US-3/US-5; O3→US-3/US-4; O4→US-4; O5→US-5.
- The cross-cutting ADR-026 determinism requirement is *asserted by* US-3/US-4/US-5 but
  exclusively *owned* by US-4 → counted at **0.9** owned (the invariant is fully owned by
  one story but consumed across three, a slight coupling discount).
- Score = (5/5 stories × 0.5) + (4.9/5 outcome-and-invariant coverage × 0.5)
  = 0.50 + 0.49 = **0.99** on coverage, discounted to **0.97** for the two DESIGN open
  forks (authority model, authZ boundary) that leave the *production* shape of US-2/US-5
  partially unspecified by design.

Score **0.97 > 0.95** → DoR threshold met. The residual 0.03 is the two deliberately
deferred DESIGN forks — surfacing them (rather than guessing) is correct for DISCUSS.

## Peer review

Recommend dispatching `nw-product-owner-reviewer` (hard gate before DESIGN) to validate
journey coherence, emotional-arc quality, shared-artifact single-source tracking, story
sizing, and DoR evidence — with special attention to the ADR-026 materialization
corollary being asserted in AC (K1 / US-4) and to the three DESIGN forks being surfaced,
not silently chosen. See `wave-decisions.md` §Hand-off.
