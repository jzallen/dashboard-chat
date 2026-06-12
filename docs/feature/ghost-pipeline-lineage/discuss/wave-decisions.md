# DISCUSS Decisions — ghost-pipeline-lineage

## Mode

**CAPTURE-ONLY.** This DISCUSS run was a preservation task, not a design task.
The user was brainstorming and asked to "preserve the idea but don't design." The
goal was to checkpoint the idea into DISCUSS-wave artifacts before it was lost.

## Key Decisions

- **[D1] Capture before elaborate:** `idea-capture.md` was written and committed
  first, reproducing the brainstorm substance faithfully, so the idea survives
  even if the rest of the wave is interrupted. (see: `idea-capture.md`)
- **[D2] No DESIGN artifacts produced:** no ADRs, C4, technology selection,
  schema/API/state-machine design, or component breakdowns. The brainstorm's
  architecture-fit note (client-side optimistic DAG / XState fit) is recorded as
  **context only**. (see: `idea-capture.md` § Architecture fit)
- **[D3] Unanswerable questions recorded, not invented:** the user was headless;
  genuine DISCUSS unknowns are logged in `open-questions.md` rather than resolved.
- **[D4] Heavyweight DISCUSS machinery deferred:** carpaccio slice briefs,
  story-map release buckets, DoR validation, numeric outcome KPIs, and peer review
  were intentionally skipped (they trend toward commitment/design). (see:
  `open-questions.md` § deferred machinery)

## Requirements Summary

- **Primary jobs:** build a working catalog from related files without
  hand-building every layer (J1); preview a proposed pipeline before trusting it
  (J2); edit one step and understand the blast radius (J3); re-run the pipeline on
  next period's files (J4); steer the agent without losing hand edits (J5).
- **North star:** replayability — the agent's edits become a durable, replayable
  reified pipeline, not just an audit log.
- **Load-bearing risk:** Dataset→View join inference — tractable as a proposal,
  dangerous as a silent autonomous commit.
- **Feature type:** user-facing (lineage-graph UI + assistant control surface),
  with backend implications for materialized preview / commit (undecided — OQ-2).

## Constraints Established (from the idea, not newly designed)

- Glass = proposed/unmaterialized; solid = committed/materialized — one graph,
  two rendering states.
- Ghost nodes must carry payload `{transform_sql_or_spec, declared_grain,
  invariant_tests}` from the start, or "commit" has nothing to execute.
- Propagate the **contract** `{columns, grain, invariants}`, not the SQL.
- Dirty-flag (lazy) propagation; no eager downstream recompute.
- Commit cascades down the DAG and must not be a footgun.
- Assistant proposes diffs into the node spec; never silently overwrites SQL.

## Upstream Changes

- None. No DISCOVER/DIVERGE artifacts existed for this feature; nothing
  back-propagated.

## Next Step

When ready to move from preservation to planning: re-run `/nw-discuss` for
story-mapping + requirements (slices, DoR, KPIs), then `/nw-design` to resolve the
open questions and choose HOW to build it.
