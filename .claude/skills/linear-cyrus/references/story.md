# Story level

A **story** = an nwave user story (a DISCUSS output). In Linear it's an **issue** in a
Feature project, assigned to a **Release** milestone, labeled **`wave:distill`** + an
`area:*`. (Stories are created during DISCUSS and moved into the Feature project at
promotion.)

## Action: `nw-distill` (orchestrator mode) — decompose into tasks

Delegate dc-cyrus on a story → it reads the real code and **decomposes the story into
work tasks** (sub-issues). It writes **no code** (coordinator tools). One story → its
own set of task sub-issues.

## Each task is created with this contract

The orchestrator's `create_issue` for every task sub-issue:

- `parentId` = the story.
- `project` = the Feature project. (Set it explicitly — the API does not auto-inherit;
  only the UI editor does.)
- **No `milestone`** — cyrus's `create_issue` can't set one, and we don't need it:
  milestone progress is tracked at the story level (see `milestone.md`).
- `state` = `"To Do"` (never Triage).
- `labels` = `wave:deliver` + the story's `area:*` (optionally `test:unit` /
  `test:integration` descriptors).

## Acceptance criteria are a CHECKLIST (not grandchild issues)

A task's spec lives as a **markdown checklist in the task's description** — each checkbox
is a test the builder writes as an atomic commit (see `task.md`). No separate "test
case" issues. A good task (DC-6 is the exemplar):

- **PR target branch** stated (`feature/<slug>`, not `main`).
- **Objective** — tightly scoped; list what's already built and must NOT be re-done.
- **Context** — the **driving port** (entry point the behavior runs through), the
  **reference pattern** to mirror, and any **design tension** named as a guarded hazard.
- **Acceptance Criteria** — the checklist. Each item is **port-to-port** (names the
  driving port), covers **error/edge paths** (not just happy path), and says what to
  assert concretely enough to write the test from.
- **Dependencies** — Linear "blocked by" links, or "none".
- **Technical Notes** — exact files, the run command, a verification block.

## Iron Rule

The checklist is the spec. A deliver session may NOT weaken or delete a checkbox to go
green. If an item can't be met, it stays unchecked and the task stays open. After 3
failed attempts on one item, revert and escalate (`needs-human`).
