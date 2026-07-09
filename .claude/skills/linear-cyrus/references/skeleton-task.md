# Skeleton task (scaffold-first)

The **first task** the orchestrator creates for every story is a **Skeleton task** — it
establishes the *shape* and the *executable spec* before any behaviour is implemented.
This is the scaffold-first discipline we used building `cyrus/`:

1. **Scaffold** the folders/files the story needs.
2. **Signatures** — define the interfaces and class/function stubs so the module
   *compiles*. Stubs return a typed placeholder or `throw new Error("not implemented")`.
3. **RED tests** — write the story's acceptance criteria as **real, failing tests** (one
   `it(...)` per AC checkbox). They define the behaviour; they're red because the stubs
   don't implement it yet.

The Skeleton task does **not** implement behaviour. Its done-state = structure compiles +
the tests exist and are RED. Once that holds, **mark the Skeleton sub-issue Done** (the
deliver session drives sub-issue status by hand — `task.md` § Done); the impl sub-issues
stay Todo until their session turns each RED test green.

## Why RED tests are fine here (no `it.skip`)

Delivery is **per story, in one session on one branch**, and the **gate is the story PR**
— *not* per task (see `branching-and-merge.md`). So the RED tests live **transiently on
the story branch** and go green as the implementation tasks land; the story PR only ever
sees the GREEN end-state. The skeleton writes **honest RED tests**, not skipped ones —
exactly like a single-session TDD flow has a transient RED phase before green.

## Where it sits

- **On the story branch, not its own.** The Skeleton is a *task*, so it has no branch of
  its own — even though Linear auto-generates a `gitBranchName` for the Skeleton sub-issue,
  ignore it. Triggering a deliver session "on the Skeleton issue" means *build on the parent
  **story branch***, starting from the skeleton's scope (see `branching-and-merge.md`).
- **Per story, never per release** — you only scaffold a story when you distill *that*
  story, so you never write all the scaffolding/tests for a feature up front.
- It is the orchestrator's **first** task sub-issue; the implementation tasks are
  **`blocked by`** it (they fill in the stubs it defined).
- Each implementation task turns one of the skeleton's RED tests GREEN — that RED→GREEN
  progression is the visible spec being satisfied.

## What the orchestrator writes for it

A Skeleton task sub-issue describes: the files/dirs to scaffold, the interfaces/signatures
to stub (with the not-implemented placeholder), and the AC tests to land RED (referencing
the story's AC checklist). Labels `wave › deliver` + the story's `area` child, like any task.
