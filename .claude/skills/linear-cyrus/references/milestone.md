# Milestone level — "Release"

A Linear **project milestone** = a **Release** (a shippable/demonstrable increment).
Milestones live **only in Feature projects**, never in Proposals. The one exception is the
**Finalize** milestone (below), which is a lifecycle stage, not a slice.

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

## The Finalize milestone (lifecycle, not a slice)

Every promoted project also gets one **Finalize** milestone, ordered **last**. It is the
one milestone that is *not* a Release slice — it holds no stories and owns no git branch.
Its **sole issue is the migrated seed** (the originating proposal/debt issue, moved in at
promotion — see `intake-and-promotion.md`). That issue is the project's **closeout handle**:
Linear delegates agent sessions to issues, not projects, so the seed is how you point cyrus
at "wind this project down."

- **Why it exists:** without it the seed is left orphaned in the backlog, stuck
  `In Progress` with an idle worktree. Migrating it under Finalize gives it a terminal role
  instead.
- **Trigger (manual):** when **all Release milestones are Done**, relabel the seed
  `wave › finalize` (assigned by hand — it does not auto-fire) and delegate dc-cyrus.
  `nw-finalize` archives artifacts to `docs/evolution/` and does project-level wrap-up; the
  seed goes **Done**, which makes its worktree prunable.
- **Not a "walking skeleton" and not a Release** — it neither ships nor demos; it closes.

## Escape hatch

If a Release outgrows a slice, **convert the milestone to a project** (Linear ⋯, or the
main session recreates it via `save_project` + moves its stories). It becomes its own
feature with its own Release branches.
