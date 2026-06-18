# User Stories — transform-operations-ir

**Wave:** DISCUSS · **Area:** backend · **Job:** JOB-003 (`docs/product/jobs.yaml`)
**Design:** ADR-051 (merged, Proposed) · **Scope:** ADR-051 in-scope only

Each story is a LeanUX story tracing to one sub-job (`jtbd-job-stories.md`) and
one ADR-051 decision. Backend feature → Elevator-Pitch "After" lines reference
real HTTP endpoints (`backend/app/routers/transforms.py`,
`prefix=/api/datasets/{dataset_id}/transforms`). Requirements completeness and
DoR are tracked in `dor-validation.md`.

---

## US-1 — Deterministic operation ordering

**As** a chat-driven author or agent shaping a dataset's staging layer,
**I want** my operations to apply in an explicit order I control,
**so that** the rendered SQL is the same every time and reflects the order I intended — not a row's insert timestamp.

Traces to: **SJ-1** · JOB-003 **O1** · ADR-051 **D1 / decision 1** · Slice **01**

### Elevator Pitch
Before: two staging operations can render in a non-deterministic order because the renderer sorts by `created_at`, and batch inserts collide on the timestamp.
After: run `PATCH /api/datasets/{id}/transforms` to set/swap operation `sequence`, then `POST /api/datasets/{id}/transforms/preview` → sees staging SQL that renders in `sequence` order and changes when two MUTATE ops are swapped.
Decision enabled: the author can trust that the preview reflects the exact order they asked for, and decide the transform chain is correct before ejecting to dbt.

### Acceptance criteria
- AC1.1: Every persisted operation has a non-null `sequence`, unique within its `dataset_id`.
- AC1.2: `POST .../preview` renders operations in ascending `sequence` order and is byte-identical across repeated calls for an unchanged list.
- AC1.3: Swapping two MUTATE operations' `sequence` on the same `target_column` produces different preview SQL.
- AC1.4: Backfill of existing production datasets does not change their previously-rendered SQL (regressions reported, not silenced).

---

## US-2 — Reject malformed operations at the boundary

**As** an author or agent submitting staging operations,
**I want** a malformed operation rejected the moment I submit it,
**so that** a broken operation never persists and never silently degrades to broken SQL later.

Traces to: **SJ-2** · JOB-003 **O2** · ADR-051 **D4 / decision 5** · Slice **02**

### Elevator Pitch
Before: operation shape is validated only inside the renderer; a malformed operation persists and surfaces hours later as a `-- Error generating SQL` comment far from the write.
After: run `POST /api/datasets/{id}/transforms` with a malformed operation → sees a `422` whose body names the offending field or discriminator, and the operations list is unchanged.
Decision enabled: the author immediately knows the operation is wrong and fixes it, instead of debugging a broken preview later with no idea which write caused it.

### Acceptance criteria
- AC2.1: An unknown discriminator value → `422` naming the discriminator; nothing persisted.
- AC2.2: A known discriminator missing a required field → `422` naming the field; nothing persisted.
- AC2.3: A well-formed operation set still persists (no regression).
- AC2.4: No `-- Error generating SQL` comment is produced for any rejected operation.

---

## US-3 — One place to define an operation's rules

**As** a developer extending the transform layer,
**I want** each operation's validate/render rules to live in one catalog entry, with a build-time check that every render target handles every operation,
**so that** adding an operation can't leave a render arm behind and a missing visitor entry can never ship.

Traces to: **SJ-3** · JOB-003 **O3** · ADR-051 **D3 / decision 4** · Slice **03**

### Elevator Pitch
Before: adding an operation means editing three `match self.operation` blocks in lockstep (`types.py:138-267`); drift between them is a latent bug.
After: run the renderer-completeness probe (e.g. `cd backend && uv run pytest -k renderer_completeness`) with a deliberately-removed catalog entry → sees the build fail naming the unhandled discriminator.
Decision enabled: a reviewer can trust that a green build means every operation is renderable by every active target, and decide the change is safe to merge.

### Acceptance criteria
- AC3.1: ibis-render and display-render output is byte-identical before vs after collapsing the three arms into the catalog (production-data golden tests).
- AC3.2: The completeness probe passes for the current vocabulary.
- AC3.3: Removing a catalog entry (or adding a discriminator with no visitor entry) fails the build naming the gap — never a runtime silent skip.

---

## US-4 — Keep the canonical IR free of any tool's dialect

**As** an author whose intent must render faithfully on more than one target,
**I want** target-specific render deltas stored separately from my operation,
**so that** the stored operation states only what I asked for, while each target can still reproduce it faithfully.

Traces to: **SJ-4** · JOB-003 **O4** · ADR-051 **D2 / decision 3** · Slice **04**

### Elevator Pitch
Before: a faithful render needs target-specific knowledge (ibis `.strip()` ASCII vs M `Text.Trim`), and there's nowhere to put it except polluting the operation config.
After: inspect a persisted operation via `GET /api/datasets/{id}?include_transforms=true` → sees a neutral operation with **no** ibis-/M-specific args (the deltas live in internal-only sidecars, never serialized).
Decision enabled: a data engineer reviewing the stored IR can trust it is pure customer intent and decide it is safe to retarget (dbt today, M tomorrow) without dialect leakage.

### Acceptance criteria
- AC4.1: An operation with no divergence has zero sidecar rows and renders identically to today.
- AC4.2: A `trim` operation's `operation_ibis_args` row pins the ASCII-vs-`Text.Trim` delta; removing the row makes the render drift in a way the divergence test detects.
- AC4.3: No sidecar field appears in the customer-facing `Transform.serialize()` output.

---

## US-5 — Import an Excel / Power Query script faithfully or not at all

**As** an Excel / Power Query user,
**I want** the supported part of my M script imported as operations and anything unsupported named back to me,
**so that** I never get a silent partial import that misrepresents what my script does.

Traces to: **SJ-5** · JOB-003 **O5** · ADR-051 **D6 / decision 2** · Slice **05**

### Elevator Pitch
Before: there is no path to bring a Power Query (M) script into the dataset; the Excel→M→operations→ibis→SQL flow has no inbound entry point.
After: run `POST /api/datasets/{id}/transforms/import-m` with an M script → sees the supported subset created as neutral operations in script order; an unsupported step (e.g. `Table.Join`) returns `422` naming the construct with nothing persisted.
Decision enabled: the user knows exactly which parts of their Excel logic came across and which they must rework — and trusts the dataset reflects their script, not a lossy guess.

### Acceptance criteria
- AC5.1: An M script of only `Text.Trim` + `Text.Lower` → `200`; equivalent neutral operations exist in script order with `sequence` assigned.
- AC5.2: An M script containing `Table.Join` → `422` naming `"Table.Join"`; operations list unchanged (no partial import).
- AC5.3: Imported operations pass the same boundary validator as direct authoring (US-2).
- AC5.4: Re-importing the same supported script is idempotent in intent.

---

## Traceability matrix

| Story | Sub-job | JOB-003 outcome | ADR-051 | ADR-051 AC | Slice | Endpoint |
|---|---|---|---|---|---|---|
| US-1 | SJ-1 | O1 | D1 / dec.1 | Ordered render; Determinism | 01 | `PATCH`/`POST .../preview` |
| US-2 | SJ-2 | O2 | D4 / dec.5 | Validation at the boundary | 02 | `POST`/`PATCH /transforms` |
| US-3 | SJ-3 | O3 | D3 / dec.4 | Renderer completeness | 03 | completeness probe (dev) |
| US-4 | SJ-4 | O4 | D2 / dec.3 | Sidecar fidelity | 04 | `GET /datasets/{id}` |
| US-5 | SJ-5 | O5 | D6 / dec.2 | Bounded parser | 05 | `POST .../import-m` (new) |

The ADR-051 **Reproducibility invariant** AC is cross-cutting (US-1 + US-3 +
US-4 together guarantee `compile(ops) == compile(load_and_recompile(ops))`); it
is the continuous reproducibility probe wired in DELIVER.
