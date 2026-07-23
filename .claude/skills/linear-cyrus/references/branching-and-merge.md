# Branching, gates, and merge

## Branch model

```
main
 └ <feature branch>                    ← the PROPOSAL issue's branch — ONE per feature
     ·  pre-promotion: docs/feature/{slug}/… + the .feature suite + roadmap.json (waves commit here)
     └ <scenario branch>               ← cyrus worktree per scenario (/nw-execute one step)
         · implementation commits (RED → GREEN for that step's .feature scenario)
         └ PR ── squash-merge ──► <feature branch>     [one atomic commit per scenario]
 <feature branch> ── Release PR, MERGE commit ──► main   [one per slice; never squash]
```

- **There is exactly one feature branch**, and it is the **proposal issue's** auto-generated
  branch. The pre-promotion waves (discuss → design → distill → partial-deliver) commit their
  artifacts onto it, so by promotion it already holds the docs, the `.feature` suite, and
  `roadmap.json`. There are **no per-Release integration branches**.
- **Scenario branches** are cut from the feature branch, one per `/nw-execute` session. Each
  **squash-merges** back into the feature branch → **one atomic commit per scenario**.
- **Release Slice issue branches are decoys — ignore them.** Linear auto-generates a
  `gitBranchName` for every issue, including each Release Slice issue and each Story issue.
  None of those are ever checked out — Slice and Story issues are validation surfaces, not
  build units (`milestone.md`, `story.md`). All code lands on scenario branches → the feature
  branch.

## Where the gate runs

| Merge | Strategy | Gate |
|---|---|---|
| **scenario branch → feature branch** | **squash** | the scenario's PR — subtree-aware `test.sh --auto`; its roadmap-step `.feature` scenario must be GREEN |
| **feature branch → `main`** (Release PR) | **merge commit — NEVER squash** | one PR per slice; opened once the slice's scenarios are green+merged and its slice AC verify (`verification.md`) |

**Why the Release PR must merge, never squash.** Scenarios squash into the feature branch as
atomic commits; the Release PR then **merges** those commits into `main` **with their SHAs
preserved**. That preservation is what lets the *next* slice's Release PR diff to only its own
commits — the prior slice never re-surfaces. A squashed Release PR breaks this: `main` gets one
squashed commit while the feature branch still holds the originals, so the next Release PR
re-shows the prior slice as conflicts. **Merge commits on the Release PR are mandatory.**

Net result: `main` becomes a **linear series of atomic scenario commits**, grouped by the slice
PR that carried them.

## Slices are sequential; scenarios within a slice parallelize

Because all Release PRs come from the **one** feature branch, a slice's Release PR carries
**everything currently on the feature branch**. So a slice must finish and PR to `main` before
the next slice's scenarios land on the feature branch — otherwise the first Release PR drags in
the next slice's partial work. **Slices serialize at the PR boundary.** Within a slice,
independent scenarios run concurrently (`parallel-execution.md`).

## Status automation (Linear ↔ GitHub)

Branch names carry the issue id → scenario branch = In Progress, scenario PR = In Review,
squash-merge = Done. Scenario issues move on their own; Story/Slice issues are advanced by the
verification steps (`verification.md`), not by branch automation.

## Review in Linear

The **scenario PR** is the review unit ([diffs](https://linear.app/docs/diffs)) — changed
files, checks, inline comments, approve + squash-merge from Linear. The **Release PR** is a
lightweight integration review (already green per scenario) before it merges to `main`.

## cyrus `baseBranch` caveat

cyrus's `baseBranch` is global (`main`). A scenario session must **base its worktree on, and
open its PR into, the feature branch** — state this in the scenario's `## AGENT NOTES` and the
delegation comment. The feature branch already exists (it is the proposal's branch), so no
per-slice branch creation is needed.
