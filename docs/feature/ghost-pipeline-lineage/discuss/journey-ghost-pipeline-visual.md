# UX Journey Sketch — Ghost Pipeline Lineage

> DISCUSS-wave capture. A lightweight journey sketch of the core flow described in
> [`idea-capture.md`](./idea-capture.md): **upload → ghost projection → navigate →
> preview-on-demand → edit-via-assistant → commit-cascade**. This is a sketch, not
> a spec — it names steps, the user's mental model, the emotional arc, and the
> artifacts passed between steps. It does **not** decide HOW any step is built.

---

## Mental model (user's vocabulary)

- The user thinks in **a map of their data**: raw files flow into cleaned tables,
  cleaned tables join into combined tables, combined tables roll up into reports.
- They read **solid = real / already there** and **glass = proposed / not yet
  real** without being taught — the rendering *is* the explanation.
- "Commit" reads as **"make this real."** "Stale" reads as **"needs a refresh."**
  "Cracked / broken" reads as **"this downstream thing no longer holds."**

---

## Happy path

| # | Step | User does | System shows (output) | Emotional state |
|---|---|---|---|---|
| 1 | **Upload** | Drops ~5 related source files | Sources + Datasets built **for real (solid)** — 1:1 staging per file | Curious → "okay, my files are in" |
| 2 | **Ghost projection** | Asks the assistant to build out the pipeline | Proposed **glass** nodes + edges from Datasets → Views → Reports appear over the solid base | Intrigued — "it drew the whole thing" |
| 3 | **Navigate** | Pans/clicks across the theoretical pipeline | Ghosts render with **confidence decay** — ghostier the further from solid ground; a special marker just downstream of an **unconfirmed join** | Oriented — sees where the risk concentrates |
| 4 | **Preview on demand** | Clicks a ghost node → modal opens; hits "load preview" | Modal shows the node's **SQL** + (on demand) **real sample rows** → node moves `proposed → previewed` (glass-but-populated) | Confidence rising — "the numbers look right" |
| 5 | **Edit via assistant** | Opens assistant pane from the open modal; asks for a change | Assistant proposes a **diff** into the node spec; user **accepts/rejects**; hand-edited SQL is never silently overwritten | In control — "it helps, I decide" |
| 6 | **Propagation preview** | (as a consequence of step 5) | Before commit: downstream marked **stale** (contract-preserving) or flagged **would-break** with named nodes/reason (contract-breaking) | Forewarned — "I see the blast radius" |
| 7 | **Commit cascade** | Selects a ghost Report, hits **Commit** | The **whole path behind it** solidifies (Datasets→View→Report); invariants fire; real numbers **re-ground** ghosts — a fan-out **cracks** the affected ghost with a reason | Accomplished, but honestly informed if something cracked |
| 8 | **Replay (later period)** | Next month's files arrive; replays the committed pipeline | Committed node specs **re-execute** on fresh files → catalog regenerates | Relieved — "the work I did once still pays off" |

**Emotional arc:** curiosity (1–2) → orientation (3) → rising confidence (4) →
agency (5–6) → accomplishment with honesty (7) → durable relief (8). Confidence
builds progressively; the one deliberate dip is step 7's "a ghost may crack" —
which is the system being **trustworthy**, not failing.

---

## Error / unhappy paths (sketch)

- **Wrong join inference (the load-bearing risk):** assistant's join is plausible
  but wrong. Mitigation in the idea: never silently commit a join; surface it as a
  proposal with a confidence marker; invariant tests fire on commit and **crack**
  the downstream ghost with a reason instead of shipping a wrong report.
- **Contract-breaking edit:** user drops/renames a column or changes grain →
  downstream **broken**, not just stale → propagation preview names exactly which
  nodes referenced the dropped column / assumed the old grain.
- **Commit a Report without its path:** disallowed — commit **cascades** the path
  behind it; the interaction must make this explicit, not a footgun.
- **Preview of an underdetermined Report (View→Report intent gap):** five files
  don't reveal intent (daily revenue by region vs customer LTV) → agent proposes
  **several** and the user picks, rather than one-shotting a guess.

---

## Shared artifacts passed between steps

| Artifact | Produced at | Consumed at | Source of truth |
|---|---|---|---|
| Sources + Datasets (solid) | Step 1 (upload) | Steps 2–7 (base of the graph) | Committed/materialized backend state |
| Ghost projection (nodes+edges+**payload**) | Step 2 | Steps 3–7 | Assistant emission: `{transform_sql_or_spec, declared_grain, invariant_tests}` |
| Node spec | Steps 2/5 | Steps 4–7 | The **SQL text** (assistant edits are diffs against it) |
| Output contract `{columns, grain, invariants}` | per node | propagation (steps 6–7) | The node it belongs to; downstream depends on the **contract**, not SQL internals |
| Materialization state (`proposed/previewed/committed`) | per node | rendering + commit | Per-node state |
| Freshness state (`fresh/stale/broken`) | propagation | rendering | Dirty-flag propagation |
| Invariant test results (e.g. row-count) | Step 7 (commit) | ghost-cracking | The committing node |

> Open questions about several of these (preview sample size, how join-confidence
> is shown, whether previews need backend compute in release 1) are recorded in
> [`open-questions.md`](./open-questions.md).
