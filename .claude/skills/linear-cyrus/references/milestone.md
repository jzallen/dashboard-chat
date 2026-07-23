# Milestone level — "Release Slice"

A Linear **project milestone** = a **Release Slice** (a DISCUSS carpaccio slice — a thin,
end-to-end, incrementally shippable band). Its source of truth is the slice brief
`docs/feature/{slug}/slices/slice-NN-*.md`, which carries the slice's **goal** (→ the
milestone/issue name) and its **own acceptance criteria**. Milestones live **only in Feature
projects**. The one exception is the **Finalize** milestone (below), a lifecycle stage, not a
slice.

## Each slice has two Linear objects

1. **The milestone** — the grouping + progress container. Stories are assigned to it.
2. **A Release Slice issue** — the **checklist surface** for the slice's own AC (from the
   brief). It is **not delegated** and generates no code; it exists so slice-AC verification
   has a home (`verification.md`) and so slice readiness is visible. Linear auto-generates a
   branch for it — **never used** (`branching-and-merge.md`).

Both are created by the **main session at promotion**, read from `slices/`. Name them from the
slice's **goal** (`slices/` brief), not from wave/artifact vocabulary (`issue-authoring.md`).

## Relationships

- **Project → Release Slice:** a Feature project has **many** slices (`Release Slice 1`, …).
- **Release Slice → Story:** a slice groups **one or more stories** — the grouping comes from
  `story-map.md`, and **every story belongs to exactly one slice** (a hard constraint: a Linear
  issue holds one milestone). Promotion rejects/re-slices any story that maps to two
  (`intake-and-promotion.md`).
- **Release Slice issue `blocked_by` its Stories** — so the slice-AC verification is gated on
  its stories being complete.
- **Slice 1 = the thinnest end-to-end increment.** Slices are **sequential** — each ships to
  `main` via its own Release PR before the next begins (`branching-and-merge.md`).

## Progress + ship

Progress = the slice's stories closing (driven by scenario merges + AC checkoff,
`verification.md`). When the slice's scenario tests are all **green + merged** and its slice AC
verify, the main session opens **one Release PR** `feature → main` (**merge commit** — never
squash) and merges it. There is no per-slice git branch — every slice ships off the single
feature branch (`branching-and-merge.md`).

## The Finalize milestone (lifecycle, not a slice)

Every promoted project also gets one **Finalize** milestone, ordered **last**. It holds no
stories and owns no meaningful branch. Its **sole issue is the migrated seed** (the originating
proposal, moved in at promotion — `intake-and-promotion.md`). That issue is the project's
**closeout handle**: Linear delegates sessions to issues, not projects, so the seed is how you
point cyrus at "wind this project down."

- **Trigger (manual):** when **all Release PRs are merged to `main`**, relabel the seed
  `wave › finalize` (by hand — it does not auto-fire) and delegate dc-cyrus. `nw-finalize`
  archives artifacts to `docs/evolution/`; the seed goes **Done**, making its worktree prunable.

## Escape hatch

If a slice outgrows a thin increment, **convert the milestone to a project** (Linear ⋯, or the
main session recreates it via `save_project` + moves its stories). It becomes its own feature
with its own feature branch.
