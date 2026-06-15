# Milestone level — "Release"

A Linear **project milestone** = a **Release** (a shippable/demonstrable increment).
Milestones live **only in Feature projects**, never in Proposals.

## Owns a branch; no agent action

At promotion the **main session** creates, per Release, both the Linear milestone
(`save_milestone`) and a git **`<feature-slug>/<release>` integration branch** (`git
branch`, cut from `main`). A milestone is not delegatable — it's a grouping + progress
container + the integration branch that story PRs land on (see `branching-and-merge.md`).

## Relationships

- **Project → Milestone:** a Feature project has **many** Releases (`Release 1`, …).
- **Milestone → Story:** a Release groups **one or more stories** (1:many); a story
  belongs to exactly one Release.
- **Release 1 = the first / thinnest increment** (ships or demos first; later Releases
  build on it). Order is sequential.

> Release 1 is **not** called a "walking skeleton" — that term is reserved for the
> per-story **Skeleton task** (`skeleton-task.md`), a different thing.

## Progress + ship

Stories are assigned to the Release (main session, at promotion). Progress = its stories
closing. When all a Release's story PRs are merged into its branch, the main session merges
**`<feature-slug>/<release>` → `main` with no PR** (already reviewed via the story PRs).

## Escape hatch

If a Release outgrows a slice, **convert the milestone to a project** (Linear ⋯, or the
main session recreates it via `save_project` + moves its stories). It becomes its own
feature with its own Release branches.
