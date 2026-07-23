# Parallelizing scenarios within a slice

Concurrency lives **at the scenario level, inside one slice**. Many scenario `/nw-execute`
sessions can run at once, each in its own cyrus worktree cut from the **feature branch**, each
squash-merging back independently. The independent unit is the **scenario**.

**Slices do NOT parallelize.** Every Release PR comes from the single feature branch and
carries whatever is on it, so a slice must finish and PR to `main` before the next slice's
scenarios land (`branching-and-merge.md`). Slices serialize at the PR boundary; scenarios
parallelize within a slice.

## When two scenarios are parallel-safe

Both must hold:

1. **Disjoint code surface.** They don't edit the same files/modules. Different `area` children
   are a strong proxy (`area › ui` vs `area › backend` rarely collide); two same-area scenarios
   need a closer look at which files each `/nw-execute` step touches (the roadmap step's
   `files_to_modify` is the tell).
2. **No dependency edge.** Neither is `blocked_by` the other. The roadmap's `phase.depends_on` /
   `step.deps` — mirrored into Linear `blocked_by` at promotion — is the authority
   (`scenario.md`).

If both hold, deliver them concurrently. They produce independent scenario PRs that squash into
the feature branch; merge in completion order (later merges rebase on the advanced feature
branch; CI re-runs on each scenario PR).

## Reading the ready batch

Open the current slice, take its scenario issues, drop any with an open `blocked_by`, group the
rest by `area` child — what remains with disjoint surface is your concurrent batch. Keep
parallel WIP to the count of genuinely independent ready scenarios; more just manufactures merge
conflicts on the feature branch.

## Collision handling

- The **feature branch is the integration point.** If two parallel scenarios touch overlapping
  code, the second to merge hits a conflict or a red gate there — caught before the Release PR,
  never on `main`.
- Resolve a conflict in the **trailing** scenario's session (re-mention with a note to rebase
  onto the updated feature branch), not the merged one.

## Rule of thumb

> Parallelize scenarios within a slice along disjoint `area`/file lines; sequence anything with
> a `blocked_by` edge; never parallelize across slices. Let the feature branch + scenario-PR CI
> be the safety net.
