# Story level

A **story** = an nwave user story. In Linear it's an **issue** in a Feature project,
assigned to a **Release** milestone. Its `wave:*` label is a **phase flag**:

| Story label | Phase | A session on the story runs as |
|---|---|---|
| `wave:distill` | awaiting breakdown | **orchestrator** (coordinator — reads code, creates sub-issues, **no code edits**) |
| `wave:deliver` | breakdown approved, building | **builder** (`all` tools — implements) |

The session mode comes from the **story's** label, *not* the sub-issues' — so the label
**is** how you move the story from planning to building.

## Phase 1 — distill (story is `wave:distill`)

Assign dc-cyrus → it reads the real code and **decomposes the story into task
sub-issues** (writes no code). It creates:

- a **Skeleton task first** (`skeleton-task.md`) — scaffold + signatures + RED tests;
- then **implementation tasks**, each one AC, **`blocked by`** the skeleton task.

Each task `create_issue`: `parentId` = the story, `project` = the Feature project,
labels `wave:deliver` + the story's `area:*`, `state: "To Do"`, and an **AC checklist** in
its description. (No `milestone` — tracked at story level.)

It ends the **story description** with a short **`## Delivery`** section: base on / PR
into `<feature>/<release>`, iterate sub-tasks in order (skeleton first), mark each Done,
one story PR.

## Phase 2 — deliver (you relabel the story `wave:deliver`)

When you're satisfied with the breakdown:

1. **Relabel the story `wave:distill` → `wave:deliver`.** (Mode is label-driven, so this
   flips a session on the story into builder mode — without it, the next session would
   run read-only and couldn't implement.)
2. **@mention dc-cyrus in a story comment:** "iterate the sub-tasks in order, `nw-deliver`
   each, mark each sub-issue Done as you go; skeleton first; one PR into
   `<feature>/<release>`."

That mints **one builder session** on the story. In its single worktree it works through
the sub-tasks — skeleton (RED tests land) then implementation (RED → green, **one atomic
commit per AC checkbox**), marking each sub-issue Done — and opens **one story PR** into
the Release branch. Sub-issues are the **plan**, never individually delegated.

## Every story body ends with an `AGENT INSTRUCTION:` section (required)

**The issue body IS the agent's prompt.** A cyrus session keys off the description; if it
doesn't name the skill/wave, the agent just presses straight to implementation (observed
on DC-8 — it skipped distill and opened a PR). So every story description ends with a
short block like:

```
---
**AGENT INSTRUCTION:** Reference the `linear-cyrus` skill for the workflow. While labeled
`wave:distill`, run `nw-distill` to DECOMPOSE this into a Skeleton task + implementation
sub-issues — create issues only, do NOT implement. When relabeled `wave:deliver`, run
`nw-deliver` to implement the AC checklist test-first and open ONE story PR into the
Release branch. Do not skip distill and jump straight to implementation.
```

The main session adds this when it materializes stories at promotion (see
`intake-and-promotion.md`).

## Iron Rule

The AC checklists are the spec. A deliver session may NOT weaken or delete a checkbox to
go green. Unmet → the box stays unchecked, the sub-issue stays open, the story PR isn't
ready. After 3 failed attempts on one item, revert and escalate (`needs-human`).
