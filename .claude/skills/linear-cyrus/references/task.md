# Task level

A **task** = an nwave deliver task (a DISTILL output / roadmap step). In Linear it's a
**sub-issue of a story**, labeled **`wave:deliver`** + the story's `area:*`, with an
**AC checklist** in its description. One task = one cyrus session = one PR.

## Action: `nw-deliver` (builder mode) — implement the checklist

Delegate dc-cyrus on a task → it implements the AC checklist **test-first**:

- For each checkbox: write the failing test, make it green — **one atomic commit per
  checkbox** (`test(scope): … (DC-NN)` / `feat(scope): …`).
- Open a **PR into the `feature/<slug>` branch** (NOT `main`). The task auto-moves to
  **In Review**; review + merge happen in Linear's diff view.

## Atomic-commit discipline

- **One checkbox → one atomic commit** (test + the code that greens it, self-contained
  and bisectable). The PR reads as a sequence of "spec item → satisfied."
- A commit message referencing the task id (e.g. `(DC-6)`) lets Linear close the task on
  merge.
- AC checkboxes are commits, **never branches** — the story-task branch is the only
  branch beneath the feature branch (see `branching-and-merge.md`).

## RED→GREEN tracking

The task's checklist is the live RED→GREEN view; boxes tick as the atomic commits land.
The Iron Rule holds (see `story.md`): don't weaken a checkbox to go green.

## Done

Task done = its PR merged into the feature branch. That rolls up to the story's progress
bar; when a Release's stories all close, the Release is done and the feature branch is a
natural candidate to PR into `main` (full gate — see `branching-and-merge.md`).
