---
name: linear-cyrus
description: >
  Use when planning, organizing, or driving work through Linear with the cyrus
  Claude Code agent — running the Proposals→feature funnel, creating projects /
  Release milestones / stories / tasks, mapping nwave waves (discuss/distill/
  deliver) to Linear labels, promoting a proposal into a feature project,
  delegating sessions to @dashboard-chat, reviewing PRs in Linear, or
  parallelizing work. Triggers: "linear", "cyrus", "proposal", "promote",
  "delegate the issue", "feature branch", "release milestone", "decompose",
  "acceptance checklist", "agent session".
---

# Linear + Cyrus workflow

How we coordinate work on this repo: **Linear is the front door, cyrus is the
hands.** Planning, review, and merge live in Linear; cyrus turns a delegated issue
into a git worktree, runs a Claude Code session, and opens a GitHub PR that you
review and merge **inside Linear** ([diffs](https://linear.app/docs/diffs)). This
replaced the gastown merge queue (retired 2026-06-15; skill parked in
`.claude/retired-skills/gastown/`).

## Who does what — the core split

**cyrus thinks; the main session structures.** It's enforced by tools:

- **dc-cyrus** has an **issue-only** Linear MCP → it runs the **waves**
  (`nw-discuss` → stories, `nw-distill` → tasks, `nw-deliver` → code) but **cannot**
  create projects or milestones.
- The **main-session assistant** has the **full** Linear MCP (`save_project`,
  `save_milestone`, `save_issue`) → it owns **structure**: projects, Release
  milestones, **promotion**, and cutting the feature branch.

## The levels (one file each in `references/`)

```
Proposals project ── wave:discuss ──►  proposal + Story sub-issues   (cyrus: nw-discuss)
      │  [main session] PROMOTE
      ▼
Feature project   = nwave feature   → git feature/<slug> branch      (main session)
  └ Release (milestone)  = shippable increment; 1:many stories; R1 = walking skeleton
      └ Story  (issue, wave:distill) ── decompose ──►  Task sub-issues  (cyrus: nw-distill)
          └ Task (sub-issue, wave:deliver)
              · AC checklist = the tests  → one atomic commit per box → PR  (cyrus: nw-deliver)
```

- **Two issue branches only:** `feature/<slug>` and a per-task branch. AC checkboxes
  are commits, never branches.
- **Gates on merge:** task PR → feature branch (slice CI); feature branch → `main`
  (full gate), a natural checkpoint when a Release's stories all close.
- **Status is automatic:** branch → In Progress, PR → In Review, merge → Done.
- **Milestone progress tracked at the STORY level** (stories on the Release; tasks are
  sub-issues, no milestone — cyrus can't set one and doesn't need to).

## Canonical lifecycle

1. Add a **proposal** issue to the **Proposals** project (`wave:discuss`).
2. Delegate dc-cyrus → `nw-discuss` enriches it + adds **story sub-issues**.
3. **Promote** (main session): create the **Feature project** + **Release milestones** +
   `feature/<slug>` branch; move the stories in (on their Release, `wave:distill`).
4. Per story: delegate dc-cyrus → `nw-distill` creates **task** sub-issues with **AC
   checklists** (`wave:deliver`).
5. Per task: delegate dc-cyrus → `nw-deliver` implements test-first (one atomic commit
   per checkbox), opens a **PR into the feature branch**.
6. Review + merge in Linear. Release done → PR the feature branch into `main`.

Independent tasks (disjoint files / no "blocked by") run **in parallel** — fire several
delegations at once (see `parallel-execution.md`).

## References

| File | Covers |
|---|---|
| `references/intake-and-promotion.md` | the Proposals→feature funnel, the cyrus-vs-main-session split, promotion mechanics |
| `references/project.md` | Proposals project vs Feature project; who creates them; `nw-discuss` |
| `references/milestone.md` | Milestone = Release; relations (1:many stories); story-level progress; promote-to-project escape hatch |
| `references/story.md` | Story = `wave:distill`; orchestrator decomposes into tasks; the task create-call contract; AC-as-checklist; Iron Rule |
| `references/task.md` | Task = `wave:deliver`; builder implements the AC checklist test-first; atomic commits; PR into feature branch |
| `references/branching-and-merge.md` | branch model, where CI gates run, Linear status automation + diff review, cyrus `baseBranch` caveat |
| `references/parallel-execution.md` | judging task independence, concurrent sessions, conflict avoidance |
| `references/linear-structure.md` | label taxonomy, routing (`teamKeys` + `labelPrompts`/orchestrator), views |
| `references/triggering-sessions.md` | how a session fires: agent-enabled app, delegate/@mention, daemon+pump, skills allowlist |

## Prerequisites (ops)

The cyrus daemon (`cyrus` on :3456) and a continuous SQS-mode pump must be running on
the devpod for delegations to drive sessions. See `references/triggering-sessions.md`
and the project memory `cyrus-local-running`.
