---
name: linear-cyrus
description: >
  Use when planning, organizing, or driving work through Linear with the cyrus
  Claude Code agent — creating issues/projects, mapping nwave waves to Linear
  labels, structuring features as feature-branch + an orchestrator story that
  decomposes into work sub-issues whose acceptance criteria are a checklist,
  delegating sessions to @dashboard-chat, reviewing PRs in Linear, or
  parallelizing independent work. Triggers: "linear", "cyrus", "delegate
  the issue", "open a PR for", "feature branch", "decompose", "acceptance
  checklist", "run these in parallel", "agent session".
---

# Linear + Cyrus workflow

How we coordinate work on this repo: **Linear is the front door, cyrus is the
hands.** High-level planning, review, and merge live in Linear; cyrus turns a
delegated issue into a git worktree, runs a Claude Code session, and opens a
GitHub PR that you review and merge **inside Linear** ([diffs](https://linear.app/docs/diffs)).

This replaced the gastown headless merge queue (retired 2026-06-15 — its skill is
parked in `.claude/retired-skills/gastown/`). cyrus now owns worktree management;
GitHub PRs + Linear review own landing.

## The model in one picture

```
Linear Project            = nwave feature   → git feature branch  (feature/<slug>)
  └ Milestone             = slice (MR-1…N)     (logical; no branch of its own)
      └ Orchestrator issue = story           wave:distill → decomposes (read-only) into ↓
          └ Work sub-issue                   wave:deliver → story branch → PR into feature branch
              · AC checklist = the tests       each checkbox = one atomic commit (test-first)
```

- **Two issue levels:** an **orchestrator/story** issue (you delegate it; it
  *decomposes*, it does not write code) and the **work sub-issues** it creates.
  **Acceptance criteria live as a markdown checklist in the work sub-issue's
  description — NOT as grandchild issues.** Each checkbox is a test the builder
  writes as an atomic commit. See `references/tdd-ac-checklist.md`.
- **Branches exist at two levels only:** the project's **feature branch**, and a
  **story branch** per work sub-issue. AC checkboxes are commits, never branches.
- **Gates run on merge:** work-sub-issue PR → feature branch (per-slice CI), feature
  branch → `main` (full gate). See `references/branching-and-merge.md`.
- **Status is automatic** from the branch/PR lifecycle: branch → In Progress,
  PR → In Review, merge → Done. No manual columns.

## Canonical lifecycle

1. **Project** per feature; the project doc holds the brief. Create its
   **feature branch** off `main` (`feature/<slug>`).
2. **`wave:discuss`** issue → delegate `@dashboard-chat` (read-only) → cyrus posts
   stories + acceptance criteria into the thread.
3. A story becomes an **orchestrator issue** under a **milestone (slice)**, labeled
   `wave:distill` + an `area:*`.
4. **`wave:distill`** (orchestrator mode, read-only/coordinator tools) → cyrus reads
   the real code and **decomposes the story into work sub-issues**, each with:
   `state: "To Do"`, `wave:deliver` + `area:*`, and an **AC checklist** (the tests).
   It sets each sub-issue's **project + milestone** to the parent's. It does NOT
   write code or auto-delegate. (Set its own project/milestone too — sub-issues do
   not inherit these automatically.)
5. **`wave:deliver`** (builder) on a work sub-issue → implements the AC checklist
   **test-first, one atomic commit per checkbox**, opens a **PR into the feature
   branch** → sub-issue auto-moves to In Review.
6. **Review + merge in Linear's diff view.** Slice CI gates the merge.
7. When the feature's milestones are done, **PR the feature branch into `main`**
   (full gate) and finalize.

## When you have many ready work sub-issues

Independent work sub-issues (no shared files / no Linear "blocked by" link) run **in
parallel** — fire several `@dashboard-chat` delegations at once; cyrus isolates each
in its own worktree and branch, all targeting the same feature branch. See
`references/parallel-execution.md` for how to judge independence and avoid collisions.

## References

| File | Covers |
|---|---|
| `references/linear-structure.md` | Project/milestone/orchestrator/work-sub-issue mapping, label taxonomy, routing (`teamKeys` catch-all + `labelPrompts`/orchestrator), views |
| `references/branching-and-merge.md` | Feature-branch model, where CI gates run, atomic AC-checkbox commits, cyrus `baseBranch` caveat, Linear status automation + diff review |
| `references/tdd-ac-checklist.md` | AC-as-checklist (not grandchild issues), distill→deliver rhythm, what a good work sub-issue looks like, Iron Rule, RED→GREEN tracking |
| `references/parallel-execution.md` | Judging work-sub-issue independence, running multiple sessions concurrently, conflict avoidance, encoding dependencies |
| `references/triggering-sessions.md` | How a session actually fires: agent-enabled app, delegate/@mention, daemon+pump prerequisites, skills allowlist, access control |

## Prerequisites (ops)

The cyrus daemon (`cyrus` on :3456) and a continuous SQS-mode pump must be running on
the devpod for delegations to drive sessions. See `references/triggering-sessions.md`
and the project memory `cyrus-local-running`.
