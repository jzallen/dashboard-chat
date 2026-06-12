# Idea Capture — Ghost Pipeline Lineage

> **Status:** DISCUSS-wave idea preservation (CAPTURE-ONLY).
> **Purpose:** Checkpoint a brainstorm so the idea is not lost. This document
> preserves the substance of the brainstorm as faithfully as practical. It is
> **not** a design. No HOW-to-build decisions are made here — those belong to a
> later DESIGN wave. Where the brainstorm left something genuinely undecided, it
> is recorded as an OPEN QUESTION rather than resolved.

---

## Framing — "agentic Power Query"

The product is essentially an **"agentic Power Query"** — more precisely, an
**agentic data-prep + catalog platform** where:

- **chat is the control surface** over a tabular pipeline, and
- **the lineage graph is the map.**

The most valuable thing that framing implies: the agent's edits should become a
**durable, REPLAYABLE step list (a reified pipeline)**, not just an audit log of
what happened.

> **North star: replayability.**

---

## dbt-aligned layer mapping

The catalog's four layers map to dbt conventions:

| Catalog layer | dbt convention | Role |
|---|---|---|
| **Source**  | raw source files | raw source files |
| **Dataset** | staging (`stg_`)  | 1:1 with a source — rename / cast / dedupe / clean. **NO joins.** |
| **View**    | intermediate (`int_`) | **where joins live** — fan related datasets together |
| **Report**  | marts | declared **grain** + aggregation, business-facing |

---

## The vision

A user uploads **~5 source files** with different-but-related schemas, and the
assistant generates a series of actions that build out **all** the catalog layers
(Sources, Datasets, Views, Reports).

### Realism assessment (from the brainstorm)

This is reasonable as a **GUIDED CASCADE**, not as one autonomous one-shot.

- **Source → Dataset (staging)** is almost purely **mechanical** (1:1, no
  cross-file reasoning) — most reliable; a deterministic profiler does most of
  the work.
- **Dataset → View (intermediate)** carries the genuinely hard part: **entity
  resolution / join-key inference** across the related schemas. An LLM is strong
  on the semantic half (column-name + sample-value matching across naming
  variance) **but 90%-right is not good enough** — a wrong join silently fans out
  or drops rows and nobody notices until a report is wrong. So: **tractable as a
  PROPOSAL, dangerous as a silent autonomous commit. This is the load-bearing
  wall.**
- **View → Report (marts)** is where **intent** lives (grain + aggregation) and
  is **underdetermined** — five files don't tell you whether the user wants daily
  revenue by region or customer LTV. The agent proposes from shape; the user
  steers. **Propose several, let the user pick** — not one-shot.

---

## The ghost-pipeline UX (the core idea to preserve)

- The lineage graph is the UI's **view-model of the pipeline** and can be
  constructed **independently of the backend**.
- Build **Sources + Datasets for real (committed)**. Then have the assistant
  return a **PROJECTION** — proposed nodes and edges from Datasets through
  Reports.
- Render the proposed solution in **GLASSMORPHISM style (ghosted / translucent)**
  while Sources and Datasets are **SOLID**.
  - **Glass = unmaterialized / proposed.**
  - **Solid = materialized / committed.**
  - **"Proposed vs committed" becomes a RENDERING STATE of one graph**, not two
    different systems.
- The user **navigates the theoretical pipeline** and decides what to commit.

---

## Node lifecycle (two independent axes)

### Materialization axis

```
proposed  (glass, structural projection only, free)
   ->  previewed  (glass-but-populated, ran on a data SAMPLE, cheap compute)
   ->  committed  (solid, materialized for real)
```

### Freshness axis

```
fresh / stale / broken   — driven by propagation (see below)
```

### Confidence decay

Confidence should **DECAY with distance from solid ground**: a ghost node
downstream of an unconfirmed join is **a guess built on a guess**. Don't render
all ghosts identically — e.g. ghostier / a confidence marker the further out, and
a **special marker immediately downstream of an unconfirmed join**.

---

## Structural projection vs materialized preview (a key fork)

- **Structural projection** = nodes + edges + per-node transform **INTENT**. Pure
  metadata; the assistant emits it as JSON; rendered fully **client-side**; zero
  backend. **Instant, fully speculative.**
- **Materialized preview** = real sample rows / a real chart in a node. **Cannot
  be faked client-side**; requires **speculatively executing** the
  staging → intermediate → mart SQL on at least a data sample (backend / compute).

The honest read: render the **SHAPE** client-side for free, but trusting a node
enough to commit it wants **real rows** → hence the middle **"previewed"** state.

---

## The node-edit interaction

- Clicking a ghost node opens a **modal** (similar to the existing upload flow),
  **NOT a full model view**. The modal shows the **SQL** and can **load a live
  preview ON DEMAND**.
- If the user likes what they see, a **Commit** button materializes it.
- The user can also open the **assistant to suggest edits**; the ghost-node
  preview modal **stays OPEN for live edits**.
- The node's **spec is the single shared state** between the SQL view and the
  assistant pane. **The SQL text is the source of truth**; the assistant proposes
  **DIFFS** into that spec which the user accepts / rejects (**do not let the
  assistant silently overwrite hand-edited SQL**). This is the
  **proposed-vs-committed pattern recursing down to edit granularity.**

---

## Propagation — "an upstream edit might trigger a downstream update"

- **Do NOT eagerly recompute** downstream on every edit. Mark downstream nodes
  **STALE instantly** (cheap, visual, no compute) and **recompute lazily** only
  when the user navigates to / previews that node. This is **dirty-flag
  propagation** (spreadsheets, dbt, reactive build graphs).
- **Propagate the CONTRACT, not the SQL.** Each node declares an **output
  contract `{columns, grain, invariants}`**. Downstream depends on the upstream
  **CONTRACT**, never its SQL internals.

Two propagation classes:

- **Contract-preserving edit** (changed a WHERE, fixed a cast; schema + grain
  unchanged) → downstream only **STALE** (same shape, new data) → cheap refresh.
- **Contract-breaking edit** (dropped / renamed a column, or changed join grain)
  → downstream may be **BROKEN**; you can detect **exactly WHICH** downstream
  nodes reference the dropped column or assumed the old grain → **"crack the
  ghosts"** with a **reason attached**.

This enables a **PROPAGATION PREVIEW**: before the edit even commits, tell the
user *"this changes the schema of `int_orders`; 2 downstream nodes reference the
column you're dropping."* The **edit-time analog of commit-time ghost-cracking.**

---

## Grain — the subtle, load-bearing detail

- Grain is **NOT purely a Report concern**. The **View / intermediate** layer must
  **PICK a grain** to join at. The classic **fan-out trap** (join 1-row-per-order
  to 1-row-per-order-line and revenue silently **doubles**) is a grain mistake
  committed at the **View** layer that only becomes **VISIBLE at the Report**
  layer.
- So grain reasoning appears **twice**: **implicitly at View** (what grain am I
  joining on?) and **explicitly at Report** (what grain am I declaring +
  aggregating to?).
- **Strongest argument for reified steps:** the agent should emit **GRAIN /
  UNIQUENESS invariant tests** alongside the join (row-count invariants
  before / after), à la `dbt_utils.equal_rowcount` / uniqueness tests — so a
  fan-out is **caught at the node where it happens** instead of three layers
  downstream. **Committing a node fires its invariant; a failed invariant visibly
  cracks the downstream ghosts.**

---

## Commit semantics

- **Commit must CASCADE down the DAG.** You can't commit a Report without its
  View, or a View without its Datasets. Selecting a ghost Report and hitting
  Commit should **solidify the whole path behind it** — a one-click "materialize
  this lineage" — and this must be **explicit in the interaction model, not a
  footgun.**
- **Committing RE-GROUNDS the ghosts:** running a real join may **diverge from the
  assistant's projection** (e.g. fan-out). The real numbers can **invalidate a
  downstream ghost's grain assumption and crack it**, with the reason shown at the
  node.

---

## The non-negotiable that makes it a pipeline instead of a diagram

The assistant must emit ghost nodes **WITH their payload from the start**:

```
{ transform_sql_or_spec, declared_grain, invariant_tests }
```

— **not just a label and a position.**

- If a ghost node is only label + position, **"commit" has nothing to execute**
  and you've built a **pretty mockup**.
- With a real payload: **commit is real**, **re-running on next month's five
  files is free**, and the **crack-the-ghosts** behavior **has something to check
  against**.

> The visual is the easy 20%; the **node payload is the 80%** that makes it a
> replayable pipeline. **The ghost DAG IS the replayable plan; commit = execute
> the node spec.**

---

## Architecture fit (CONTEXT ONLY — not to be expanded into design)

> Recorded as context only. **Do NOT design the machines** — that is the DESIGN
> wave.

This is a **client-side optimistic DAG with a per-node materialization state
machine**, which fits the project's **ui-state / XState v5** architecture (a
**parent graph machine** coordinating **per-node child machines**). Precedent:
the existing **source-upload coordinator machine**.

---

## Provenance

This document preserves a brainstorm conducted on 2026-06-12. The user was
brainstorming and asked to "preserve the idea but don't design." The substance
above is reproduced as faithfully as practical; headings organize it lightly. No
requirements were invented beyond what the brainstorm contained.
