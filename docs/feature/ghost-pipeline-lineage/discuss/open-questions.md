# Open Questions — Ghost Pipeline Lineage

> DISCUSS-wave capture. Everything the brainstorm in
> [`idea-capture.md`](./idea-capture.md) left **genuinely undecided**. These are
> recorded, not answered — inventing answers would be design, which is out of
> scope. Each carries the resolution wave where it most naturally belongs.

| # | Open question | Why it's open (from the brainstorm) | Likely wave to resolve |
|---|---|---|---|
| OQ-1 | **Preview sample size.** How many rows / what sampling strategy backs a "previewed" node? | Brainstorm names a "data SAMPLE / cheap compute" but never sizes it. | DESIGN |
| OQ-2 | **Does preview require backend compute in the first release?** Can release 1 ship structural projection only (zero backend) and defer materialized preview? | Brainstorm explicitly forks "render the SHAPE client-side for free" vs "real rows require backend/compute" and calls the middle state the honest necessity — but doesn't decide release sequencing. | DESIGN / story-mapping |
| OQ-3 | **How is join confidence surfaced visually?** "Ghostier the further out" + "a special marker downstream of an unconfirmed join" — what does the marker actually look like, and is confidence a discrete badge or a continuous gradient? | Brainstorm gives the principle (confidence decay) but not the visual encoding. | DESIGN |
| OQ-4 | **What exactly does an "unconfirmed join" → "confirmed join" transition require from the user?** Click-to-accept? Preview-then-accept? | The load-bearing wall (Dataset→View join inference) is "a proposal, not a silent commit," but the confirmation gesture is unspecified. | DISCUSS-follow-up / DESIGN |
| OQ-5 | **Invariant test catalog.** Which invariants does the agent emit by default (row-count equal_rowcount, uniqueness on declared grain, others)? | Brainstorm cites `dbt_utils.equal_rowcount` and uniqueness "à la" — illustrative, not a fixed set. | DESIGN |
| OQ-6 | **Replay semantics on schema drift.** When next period's files have a slightly different schema, does replay re-infer, fail, or surface a diff? | "Re-running on next month's five files is free" assumes schema stability; drift behavior is unaddressed. | DESIGN |
| OQ-7 | **Report-intent disambiguation UX.** When the agent proposes "several" Reports for an underdetermined mart, how many, and how does the user pick/steer? | Brainstorm says "propose several, let the user pick" without a count or selection mechanism. | DISCUSS-follow-up / DESIGN |
| OQ-8 | **Commit-cascade confirmation.** One-click "materialize this lineage" must "not be a footgun" — what confirmation/preview precedes a cascade that materializes many nodes (and may incur real compute cost)? | Brainstorm flags the footgun risk but doesn't specify the guardrail. | DESIGN |
| OQ-9 | **Diff granularity for assistant edits.** The assistant proposes "diffs into the spec" — diffs at SQL-text level, AST level, or contract level? | Brainstorm establishes "SQL text is source of truth, assistant proposes diffs" but not the diff representation. | DESIGN |
| OQ-10 | **Where ghost/projection state lives & how durable it is.** Client-side optimistic DAG is noted as architecture *fit* only; persistence of an uncommitted ghost projection across sessions is undecided. | Brainstorm deliberately stops at "RECORD THIS AS CONTEXT ONLY; do not design the machines." | DESIGN |
| OQ-11 | **Scope of "all four layers" in release 1.** Is the first deliverable the full Source→Report cascade, or a thinner slice (e.g. Source→Dataset→View only)? | Brainstorm describes the full vision but warns against one-shot autonomy; no slice boundary is drawn. | DISCUSS story-mapping (deferred) |
| OQ-12 | **Cost/latency budget for speculative execution.** Previews and commits run real SQL on samples/full data — what's acceptable cost and latency, and who pays for previews of nodes never committed? | Brainstorm notes "cheap compute" for preview and "for real" for commit, but sets no budget. | DESIGN / DEVOPS |

---

## Note on deferred DISCUSS machinery

Per the capture-only scope of this wave run, the following standard DISCUSS
artifacts were **intentionally not produced** (they trend toward commitment/design
the user asked to defer): elephant-carpaccio slice briefs, story-map release
buckets, DoR validation, outcome KPIs with numeric targets, and peer review. When
the user is ready to move from preservation to planning, those are the natural
next outputs — re-run `/nw-discuss` for story-mapping + requirements, then proceed
to `/nw-design`.
