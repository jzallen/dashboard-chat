# Scenario level — the codegen unit

A **scenario** = one nwave DELIVER **roadmap step** (`roadmap.json`; `phase → step`, a step
carries `criteria` + `scenario_name`/`test_file`). By construction **1 acceptance scenario =
1 step = 1 TDD cycle**. In Linear it is an **issue with no milestone**, labeled `wave ›
deliver` + the story's `area` child. It is the **only unit that generates code** — Slice and
Story issues are validation surfaces (`milestone.md`, `story.md`).

## Where scenarios come from

Scenario issues are **created by the main session at promotion**, read out of the committed
`roadmap.json` (produced by the proposal's partial-`nw-deliver`). One issue per roadmap step.
Do **not** hand-author scenarios ad hoc — the roadmap is their source of truth, so their
count, criteria, and ordering come from it.

The `.feature` acceptance tests each scenario turns green already exist on the feature branch
— DISTILL committed the whole suite during the proposal phase. A scenario's job is to make
**its** step's test go from RED to GREEN; there is **no per-story skeleton step** anymore (the
DISTILL suite subsumes it).

## Delivery — one `/nw-execute` session each

Each scenario is delegated to dc-cyrus and delivered in its own session:

1. Delegate dc-cyrus on the scenario issue (`wave › deliver`). The body's `## AGENT NOTES`
   names the command: **`/nw-execute <feature-slug> <step-id>`** (e.g. `01-02`) and the
   **feature branch** to base on / merge into.
2. cyrus cuts a **scenario branch** off the **feature branch** (not `main` — see the
   `baseBranch` caveat in `branching-and-merge.md`), implements the step test-first until its
   `.feature` scenario is GREEN, and opens a PR **into the feature branch**.
3. The PR **squash-merges** into the feature branch → **one atomic commit per scenario**
   (`branching-and-merge.md`).

## Dependencies

Scenario issues are wired with Linear **`blocked_by`** relations straight from the roadmap's
`phase.depends_on` / `step.deps`. That dependency graph — **not** milestones — is what
sequences scenarios. Anything not in a blocking chain (and inside the same slice) is a
candidate for the parallel batch (`parallel-execution.md`).

## On merge — reconstruct the story link (agent judgment)

nwave never persists which story a scenario serves. So when a scenario merges to the feature
branch, the delivering session makes a **runtime judgment** (`verification.md`):

- decide which **Story AC** the completed work satisfies (closest match, even on partial
  satisfaction);
- mark the scenario issue **related to** those stories (`save_issue` relation);
- check the satisfied **Story AC boxes** on the story issue.

There is no `@US-NN` tag or persisted map — this is a gut call, and it is a *validation
surface* signal, not the release gate. The gate is the green scenario suite (`verification.md`).

## Done

A scenario is Done when its PR squash-merges into the feature branch and its roadmap-step
`.feature` scenario is **green**. Status automation (branch → In Progress, PR → In Review,
merge → Done) keys on the scenario branch/PR, so the scenario issue moves on its own — unlike
the retired task sub-issues, there is no by-hand status babysitting.

## Iron Rule

The `.feature` acceptance scenario is the spec. A scenario session may **not** weaken, skip,
or delete a scenario/assertion to go green. Unmet → the scenario stays open, its step test
stays RED, its slice can't release. After 3 failed attempts, revert and escalate
(`needs-human`).
