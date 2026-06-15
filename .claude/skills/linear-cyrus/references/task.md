# Task level

A **task** = an nwave deliver step. In Linear it's a **sub-issue of a story**, labeled
`wave:deliver` + the story's `area:*`, with an **AC checklist** in its description. It is
**the plan**, not a separately-delegated unit: the story's single deliver session iterates
the tasks and marks each Done as it goes.

## Two kinds of task

1. **Skeleton task** (always first) — scaffold + signature stubs + the story's AC checklist
   landed as **RED tests**. No behaviour. See `skeleton-task.md`.
2. **Implementation tasks** — each takes one AC and turns its RED test **green**, **one
   atomic commit per AC checkbox** (`feat(scope): … (DC-NN)`). Each is **`blocked by`** the
   skeleton task.

## No task branches / no task PRs

Tasks are **commits inside the story's deliver session**, on the story branch — never their
own branches or PRs (see `branching-and-merge.md`). RED is transient on the story branch;
the **story PR** is the only gate and sees green.

## Done

A task is Done when its commit(s) land and (for implementation tasks) its AC test is green.
The session marks each sub-issue Done as it goes — the live RED→GREEN tracker. When every
task is Done, the story PR is ready for review.
