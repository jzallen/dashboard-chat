# Story Map — transform-operations-ir

**Wave:** DISCUSS · **Area:** backend · **Job:** JOB-003 · **Scope:** ADR-051 in-scope only (staging tier; M-outbound + View/Report deferred)

## Backbone (user activities, left → right)

```
 AUTHOR / IMPORT          →  VALIDATE              →  PERSIST (ordered)      →  RENDER (derived)       →  IMPORT FROM EXCEL
 shape staging layer         catch bad ops at         store the canonical       compile deterministic     bring M scripts into
                             the door                 operations list           ibis/SQL                  the same list
 ───────────────            ───────────────          ───────────────           ───────────────           ───────────────
 POST/PATCH /transforms     422 on malformed         transforms + sequence     POST /preview             POST /import-m
```

## Walking skeleton

Not applicable as a *new* end-to-end skeleton — this is brownfield. The
end-to-end path (author → persist → render staging SQL) **already exists**; the
DESIGN Reuse Gate (PASS) confirms every element is an EXTEND. The "skeleton"
here is the existing `transforms → dataset_sql.build_ibis_table` path. Each slice
hardens one rib of that skeleton without forking it.

## Slices (elephant-carpaccio — each ships end-to-end in ≤1 day)

| Slice | Title | Sub-job | ADR-051 | Story | Learning hypothesis (disproves if it fails) |
|---|---|---|---|---|---|
| **01** | Deterministic operation ordering (`sequence`) | SJ-1 | D1 / dec.1 | US-1 | Disproves that a `sequence` backfill can be applied to existing datasets **without changing their currently-rendered SQL**. |
| **02** | Reject malformed operations at the boundary | SJ-2 | D4 / dec.5 | US-2 | Disproves that a boundary discriminated union can reject **every** malformed shape the renderer currently swallows into a comment. |
| **03** | One dispatch catalog + renderer-completeness probe | SJ-3 | D3 / dec.4 | US-3 | Disproves that the three triplicated rule arms collapse to one catalog **with byte-identical render output** (if they differ, drift already exists today). |
| **04** | Sparse per-target adapter-args sidecars | SJ-4 | D2 / dec.3 | US-4 | Disproves that target divergences are **sparse** (if most ops need a sidecar row, the neutral vocabulary is leaky). |
| **05** | Bounded inbound M (Power Query) import | SJ-5 | D6 / dec.2 | US-5 | Disproves that the bounded M subset maps **cleanly** to the operation vocabulary (if a common M step has no neutral equivalent, vocabulary must extend first). |

## Dependency chain

```
  01 sequence ──────────────┐
                            ├──> (loaders order_by(sequence) in place)
  02 boundary-validation ───┤
                            │
  03 dispatch-catalog ──────┼──> 04 sidecars   (04 needs the catalog/visitor shape)
                            └──> 05 M-import    (05 needs boundary validation; reuses catalog)
```

- **04 blockedBy 03** — sidecars left-join into a renderer that must already be a visitor over the catalog.
- **05 blockedBy 02** — the M parser emits neutral operations that go through the *same* boundary validator.
- **05 benefits-from 03** — adding the inbound M visitor is "one new visitor" only once the catalog exists; without it, 05 grows.

## Scope guardrails (from ADR-051, confirmed "in-scope only")

- **OUT:** outbound operations→M renderer (admitted by catalog, deferred).
- **OUT:** View/Report normalization onto the operations model (separate proposal).
- **OUT:** general M bridge (joins, pivots, type engines) — bounded subset only.

## Non-story (build-time guard, not a slice of its own)

The **renderer-completeness probe** is delivered *inside* Slice 03 (it is what
makes the catalog trustworthy) and re-asserted by Slices 04/05 (each new visitor
or sidecar must keep it green). It is not a separately shippable user value.

See `prioritization.md` for execution order rationale and `../slices/` for the
per-slice briefs.
