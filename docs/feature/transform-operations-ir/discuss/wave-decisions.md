# DISCUSS Decisions — transform-operations-ir

**Wave:** DISCUSS · **Area:** backend · **Feature type:** Backend · **Walking skeleton:** No (brownfield)

## Wave-ordering note (read first)

DISCUSS normally precedes DESIGN, but for this feature **DESIGN ran first** and is
already merged (ADR-051, `design/`). This is the CLAUDE.md brownfield routing:
`transform-operations-ir` entered as a `wave:refactor` evaluation. This DISCUSS
pass was run *after* DESIGN, at the Mayor's request, to formalize the merged
design into a validated JOB, journey, story map, and DoR-ready slices that drive
**DISTILL** next. No DESIGN decision was re-opened; DISCUSS reads ADR-051 as the
authority and traces every story back to it.

## Key Decisions

- **[D1] Light JTBD bridge, not full DIVERGE.** The job was already articulated by
  ADR-051; added **JOB-003** to `docs/product/jobs.yaml` with three dimensions +
  four forces, but ran no multi-job opportunity study. (see: `jtbd-job-stories.md`,
  `jtbd-four-forces.md`)
- **[D2] Story scope = ADR-051 in-scope only.** Stories cover sequence ordering,
  boundary validation, dispatch catalog, sparse sidecars, bounded **inbound** M
  import. Outbound M renderer and View/Report normalization are explicitly
  **out**, matching ADR-051 §Scope/Non-goals. (Mayor decision, this session.)
- **[D3] Five elephant-carpaccio slices, abstraction shipped first.** The dispatch
  catalog (Slice 03) ships before its dependents (04 sidecars, 05 M import) per the
  carpaccio "ship the abstraction first" rule. (see: `story-map.md`,
  `prioritization.md`)
- **[D4] Order by learning leverage + anxiety.** Slice 01 (`sequence` migration)
  goes first because the migration is the dominant restraining force; Slice 05 (M
  import) goes last as the highest-variance payoff. Both carry a pre-slice SPIKE.
  (see: `prioritization.md`, `jtbd-four-forces.md`)
- **[D5] Backend Elevator Pitches reference real HTTP endpoints.** `POST`/`PATCH
  /api/datasets/{id}/transforms`, `.../preview`, and a new `.../import-m`. US-3's
  observable is the build-failing completeness probe (so no slice is pure
  `@infrastructure`). (see: `user-stories.md`)
- **[D6] J-005 not yet promoted to SSOT.** The backend journey here
  (`journey-transform-operations-ir.yaml`) supplies the server-owned source-of-
  truth half of the provisional **J-005** "Transform toggles" journey; full SSOT
  promotion waits until its UI/state-machine dimension (JOB-002) lands. Recorded in
  `journeys/_inventory.md`.

## Requirements Summary

- **Primary job:** Keep dataset staging changes tool-agnostic and deterministic
  through a canonical operations IR (JOB-003).
- **Walking skeleton scope:** none — the end-to-end path already exists; each slice
  hardens one rib.
- **Feature type:** Backend (FastAPI + SQLAlchemy + ibis/DuckDB; Alembic migration
  in Slice 01).

## Constraints Established

- Operations are the only durable authority; ibis/SQL always derived (ADR-051 hard
  invariant — carried into every story's AC).
- `sequence` is mandatory; `created_at` demoted to provenance.
- Bounded M parser: out-of-vocabulary M rejected by name at parse time, no partial
  import.
- Sidecars internal-only, sparse, per-target; never in `Transform.serialize()`.
- No rules-as-data (ADR-026); no new runtime dependency.

## Upstream Changes

- None to DISCOVER (no DISCOVER artifacts exist for this feature). No DESIGN
  decision changed — DISCUSS is downstream of the merged ADR-051 here.

## Hand-off

- **To DISTILL** (`/nw-distill`): write BDD acceptance tests from
  `journey-transform-operations-ir.feature` + the per-slice AC, and a
  `roadmap.json` ordered per `prioritization.md`. ADR-051's Earned-Trust probes
  (renderer-completeness, M round-trip, reproducibility, substrate-divergence) are
  first-class DISTILL/DELIVER test deliverables.
- **To DEVOPS** (KPIs only): `outcome-kpis.md`.
