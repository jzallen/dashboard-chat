# JTBD Job Stories — Ghost Pipeline Lineage

> DISCUSS-wave capture. Job stories derived faithfully from the brainstorm in
> [`idea-capture.md`](./idea-capture.md). No design decisions; these name the
> *jobs* the ghost-pipeline idea exists to serve. Job-story form:
> **When [situation], I want to [motivation], so I can [outcome].**

---

## J1 — Build a working catalog from related files without hand-building every layer

**When** I've just uploaded several related-but-different source files,
**I want to** have the assistant propose the whole downstream pipeline
(Datasets → Views → Reports) for me,
**so I can** get to a working catalog without manually authoring every staging,
join, and mart layer by hand.

- **Functional:** turn ~5 raw files into a structured Source/Dataset/View/Report
  catalog with minimal manual SQL authoring.
- **Emotional:** relief at not facing a blank canvas; momentum instead of dread.
- **Social:** look like someone who ships a modeled catalog quickly, not someone
  stuck wiring joins for a day.

*Realism note from brainstorm: this is a **guided cascade**, not an autonomous
one-shot — Source→Dataset is mechanical, Dataset→View needs human-confirmed join
inference, View→Report needs human intent.*

---

## J2 — Preview a proposed pipeline before trusting it

**When** the assistant has projected a pipeline of nodes I didn't author myself,
**I want to** inspect each proposed node — its SQL, and real sample rows on
demand — before committing anything,
**so I can** trust a node enough to materialize it instead of taking a guess on
faith.

- **Functional:** see the SHAPE for free (structural projection) and pull REAL
  sample rows (materialized preview) when I want proof.
- **Emotional:** confidence that builds as I move from "proposed" to "previewed"
  to "committed"; no blind leaps.
- **Social:** defensible — I can show I checked the numbers before publishing a
  report.

---

## J3 — Edit one step and understand the blast radius before I commit

**When** I change a transform on one node (e.g. drop a column, fix a cast, change
a join),
**I want to** be told instantly which downstream nodes go stale and which would
break, and why,
**so I can** make the edit knowing its consequences instead of silently corrupting
a report three layers downstream.

- **Functional:** dirty-flag staleness + contract-breaking detection with named
  downstream impact ("2 nodes reference the column you're dropping").
- **Emotional:** safety — the system catches the fan-out at the node where it
  happens, not after a wrong report ships.
- **Social:** trustworthy data — I don't hand stakeholders a silently-doubled
  revenue number.

---

## J4 — Re-run the same pipeline on next period's files

**When** next month's batch of the same five files arrives,
**I want to** replay the pipeline I already built and committed,
**so I can** regenerate the whole catalog for free instead of rebuilding every
layer from scratch each period.

- **Functional:** the committed ghost DAG is a reified, replayable plan; commit =
  execute the node spec, so re-execution on fresh files is cheap.
- **Emotional:** durability — the work I did once keeps paying off.
- **Social:** reliable cadence — stakeholders get the same reports on schedule
  without heroics.

---

## J5 — Steer the agent on a node without losing my own edits

**When** I've hand-edited a node's SQL and then ask the assistant to suggest a
change,
**I want to** receive the assistant's change as a diff I accept or reject against
my spec,
**so I can** collaborate with the agent without it silently overwriting work I
just did by hand.

- **Functional:** the node spec is shared state; SQL is source of truth; assistant
  proposes diffs, never silent overwrites — the proposed-vs-committed pattern at
  edit granularity.
- **Emotional:** control — I stay the author; the agent assists.
- **Social:** ownership of the result; I can stand behind SQL I approved.

---

## Job → downstream-artifact bridge

| Job | Journey step(s) it drives | AC group |
|---|---|---|
| J1 | upload → ghost projection | AC-1, AC-2 |
| J2 | navigate → preview-on-demand | AC-3, AC-4 |
| J3 | edit-via-assistant → propagation preview | AC-5, AC-6 |
| J4 | commit-cascade → replay | AC-7, AC-8 |
| J5 | edit-via-assistant (diff acceptance) | AC-6 |

> Traceability is indicative only — these are capture-wave jobs, not yet
> committed scope.
