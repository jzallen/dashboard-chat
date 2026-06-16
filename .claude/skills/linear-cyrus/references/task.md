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

**Updating sub-issue status is the deliver session's own job — do not skip it.** The
status automation (branch → In Progress, PR → In Review, merge → Done) keys on the
**story branch / story PR**, so it moves the **story**, *never* the task sub-issues. The
session therefore drives each sub-issue's status by hand as it works:

- **Todo → In Progress** when you start the task (the skeleton first, then each impl task).
- **In Progress → Done** the moment its commit lands and (for impl tasks) its AC test is
  green — including the **Skeleton** sub-issue, which is Done once `ui/` compiles and the
  RED tests exist (its done-state, per `skeleton-task.md`).

Tasks you have not started stay **Todo**. This per-sub-issue progression is the live
RED→GREEN tracker on the story; leaving them all Todo while the branch/PR moves makes the
story look unbroken-down. When every task is Done, the story PR is ready for review.

**Checklist before ending a deliver session:** every sub-issue you actually delivered is
marked Done (use `save_issue(state: "Done")` / `linear_get_child_issues` to confirm), and
any sub-issue you did *not* implement is still Todo — never leave a delivered task in Todo.
