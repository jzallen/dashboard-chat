# Branching, gates, and merge

## Branch model

```
main
 └ <feature-slug>/<release>          ← milestone (Release) branch — created at promotion
     └ <story branch>                ← cyrus worktree branch for the story's deliver session
         · skeleton commits (scaffold + signatures + RED tests)
         · implementation commits (RED → GREEN, one per AC checkbox)
         └ PR ─────────────────────► merges INTO <feature-slug>/<release>   [story PR — the gate]
 <feature-slug>/<release> ── merge, NO PR ──► main   [when all the Release's story PRs merged]
```

- **Milestone (Release) branches** are the integration branches — one per Release,
  e.g. `dataset-bff/release-1`. The **main session** creates them at promotion (cut from
  `main`).
- **Story branch** — one cyrus worktree branch per story deliver session. The whole story
  (skeleton + implementation) is built here, so **RED is transient on this branch**.
- **No task branches, no task PRs.** Tasks are the deliver session's internal plan
  (sub-issues it marks Done), realized as commits — not branches.
- **Sub-issue branch names are decoys — ignore them.** Linear auto-generates a
  `gitBranchName` for *every* issue, including the Skeleton task and implementation
  sub-issues. Do **not** base a worktree on, check out, or commit to a sub-issue's branch.
  All of a story's work (skeleton + every impl task) lands on the **parent story branch**.
  When a deliver session is triggered on a sub-issue (e.g. "start with the Skeleton issue"),
  it still builds on the parent **story branch** — the sub-issue is just the unit of work to
  start from, not a branch to switch to.

## Where the gate runs

| Merge | Gate | Why here |
|---|---|---|
| **story branch → `<feature>/<release>`** | **story PR** — subtree-aware `test.sh --auto` | the one review + CI gate; sees only the GREEN end-state (RED was transient on the branch) |
| **`<feature>/<release>` → `main`** | none — merge, **no PR** | already reviewed via the story PRs; this is just integration |

Per-task work has **no** gate — tasks land as commits inside one session. That's exactly
what lets the skeleton commit honest **RED** tests: nothing gates the transient RED, only
the assembled green **story**.

## Releases are sequential

Milestone branches are cut from `main`. Release N merges to `main` when done, then
Release N+1 is (re)based on the updated `main`, so later Releases build on earlier ones.
If you cut all Release branches at promotion, **rebase** a later one onto `main` after the
prior Release merges.

## Status automation (Linear ↔ GitHub)

Branch names carry the issue id → branch = In Progress, PR = In Review, merge = Done. The
**story PR** drives the story's status; closing all of a Release's stories advances the
Release milestone; merging the Release branch to `main` is the ship.

## Review in Linear

The **story PR** is the review unit ([diffs](https://linear.app/docs/diffs)) — changed
files, checks, inline comments, approve + merge from Linear. One coherent PR per story
beats many tiny task PRs.

## cyrus `baseBranch` caveat

cyrus's `baseBranch` is global (`main`). A story's deliver session must **base its
worktree on, and open its PR into, the Release branch** `<feature>/<release>` — state this
in the story's `## Delivery` section and the deliver comment. Create the Release branch
(main session) before delivering the first story of that Release.
