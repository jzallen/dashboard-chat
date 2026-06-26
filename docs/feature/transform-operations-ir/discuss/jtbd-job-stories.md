# JTBD Job Stories — transform-operations-ir

**Wave:** DISCUSS · **Mode:** light JTBD bridge (no DIVERGE) · **Area:** backend

This is a *bridge*, not a full ODI study. The job was already articulated
narratively by the merged DESIGN (`docs/decisions/adr-051-operations-as-canonical-transform-ir.md`).
This file formalizes it into job-story form, names its three dimensions, and
records the SSOT job it lands as (**JOB-003** in `docs/product/jobs.yaml`). A
full DIVERGE Phase-1 study (real-user interviews, measured satisfaction) was not
run because there is a single, well-evidenced job and the architecture decision
is already ratified.

---

## Primary job (JOB-003)

> **When** I change a dataset's staging layer — authoring operations directly or
> importing them from an Excel / Power Query (M) script — **I want** those changes
> captured as one canonical, ordered list of neutral operations that
> deterministically renders to ibis (and onward to DuckDB preview and ejected dbt
> SQL), **so I can** trust that the preview I see, the dbt I eject, and the M I
> imported all describe the same intent — without any single tool's dialect
> leaking into the stored source of truth.

### Three dimensions

| Dimension | Content |
|---|---|
| **Functional** | Persist staging changes as a canonical, *sequenced* list of neutral operations; render deterministically to ibis/SQL; import the bounded M subset into the same list; reject malformed/out-of-vocabulary input at the boundary. |
| **Emotional** | Confidence at the moment of submission. Learn *immediately* that an operation is well-formed and will render — never discover a `-- Error generating SQL` comment buried in a later preview, never get a silently reordered transform that yields the wrong column. |
| **Social** | The staging layer should *read* like a clean compiler IR to a data-engineer peer: operations are data, rendering is code, SQL is always derived — not triplicated `match` blocks ordered by insert timestamp. |

---

## Sub-jobs (the job decomposed — these become the journey steps and stories)

| # | Sub-job (job-story form) | Feeds story | ADR-051 decision |
|---|---|---|---|
| SJ-1 | When I add or reorder staging operations, I want their execution order to be explicit and deterministic, so the rendered SQL is the same every time and reflects the order I intended. | US-1 | D1 / decision 1 (`sequence`) |
| SJ-2 | When I submit a staging operation, I want a malformed one rejected at the boundary with a clear error, so a broken operation never persists or silently degrades to broken SQL. | US-2 | D4 / decision 5 (boundary validation) |
| SJ-3 | When the team adds a new operation or render target, I want one place to define its rules, so the validate/ibis/display arms cannot drift apart. | US-3 | D3 / decision 4 (dispatch catalog + completeness probe) |
| SJ-4 | When a target (ibis vs M) must shape an operation differently to stay faithful, I want that delta stored separately from the neutral intent, so the canonical IR never carries a tool's dialect. | US-4 | D2 / decision 3 (sparse sidecars) |
| SJ-5 | When I import an Excel / Power Query (M) script, I want the supported subset turned into neutral operations and anything unsupported rejected by name, so nothing is silently dropped or half-imported. | US-5 | D6 / decision 2 (bounded inbound M parser) |

Every story in `user-stories.md` traces to exactly one sub-job; every sub-job
traces to an ADR-051 decision with `file:line` evidence in `evaluation.md`.

---

## Why these are the right jobs (evidence pointers)

- **SJ-1** — order is non-commutative yet clock-pinned: `dataset_sql.py:104-107`
  sorts MUTATE ops by `created_at`; batch inserts collide on the timestamp
  (`repository.py:657-671`). (`evaluation.md` §3)
- **SJ-2** — validation happens only inside the renderer and failure degrades to
  a comment: `dataset_sql.py:46-50`. (`evaluation.md` §6, Finding 1)
- **SJ-3** — the same `match self.operation` spine is walked three times:
  `types.py:138-267`. (`evaluation.md` §5)
- **SJ-4** — real divergences exist: ibis `.strip()` ASCII vs M `Text.Trim`
  (`types.py:197`); custom case UDFs (`types.py:191,206-210`). (`evaluation.md` §4)
- **SJ-5** — the bounded-parser constraint and reject-by-name contract are fixed
  in ADR-051 decision 2; the inbound path is the immediate Excel→SQL driver.

See `jtbd-four-forces.md` for the adoption-forces analysis.
