---
name: linear-cyrus
description: >
  Use when planning, organizing, or driving work through Linear with the cyrus
  Claude Code agent — creating issues/projects, mapping nwave waves to Linear
  labels, structuring features as feature-branch + story sub-issues + test-case
  grandchildren, delegating sessions to @dashboard-chat, reviewing PRs in Linear,
  or parallelizing independent stories. Triggers: "linear", "cyrus", "delegate
  the issue", "open a PR for", "feature branch", "test-case sub-issues",
  "run these in parallel", "agent session".
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
Linear Project           = nwave feature      → git feature branch  (feature/<slug>)
  └ Milestone            = slice (MR-1…N)        (logical; no branch of its own)
      └ Issue (sub-issue) = story / build unit  → story branch → PR into feature branch
          └ sub-sub-issue = a test case         → ONE atomic commit on the story branch
```

- **Branches exist at two levels only:** the project's **feature branch**, and a
  **story branch** per sub-issue. Test-case grandchildren are **atomic commits**,
  never branches.
- **Gates run on merge:** story PR → feature branch (per-slice CI), feature branch
  → `main` (full gate). See `references/branching-and-merge.md`.
- **Status is automatic** from the branch/PR lifecycle: branch → In Progress,
  PR → In Review, merge → Done. No manual columns.

## Canonical lifecycle

1. **Project** per feature; the project doc holds the brief. Create its
   **feature branch** off `main` (`feature/<slug>`).
2. **`wave:discuss`** issue → delegate `@dashboard-chat` (read-only) → cyrus posts
   stories + acceptance criteria into the thread.
3. Stories become **sub-issues** under **milestones (slices)**, each with an `area:*`.
4. Per story: **`wave:distill`** session writes the *failing* tests and creates the
   **test-case grandchildren** (RED, interface mapped first).
5. **`wave:deliver`** session reads the grandchildren as the spec, implements until
   green with **one atomic commit per test case**, opens a **PR into the feature
   branch** → story auto-moves to In Review.
6. **Review + merge in Linear's diff view.** Slice CI gates the merge.
7. When the feature's milestones are done, **PR the feature branch into `main`**
   (full gate) and finalize.

## When you have many ready stories

Independent stories (no shared files / no Linear "blocked by" link) run **in
parallel** — fire several `@dashboard-chat` delegations at once; cyrus isolates each
in its own worktree and branch, all targeting the same feature branch. See
`references/parallel-execution.md` for how to judge independence and avoid collisions.

## References

| File | Covers |
|---|---|
| `references/linear-structure.md` | Project/milestone/issue/test-case mapping, label taxonomy, routing (`teamKeys` catch-all + `labelPrompts`), views |
| `references/branching-and-merge.md` | Feature-branch model, where CI gates run, atomic test-case commits, cyrus `baseBranch` caveat, Linear status automation + diff review |
| `references/tdd-test-cases.md` | Test-cases-as-grandchildren, two-session distill→deliver rhythm, Iron Rule, RED→GREEN tracking |
| `references/parallel-execution.md` | Judging story independence, running multiple sessions concurrently, conflict avoidance, encoding dependencies |
| `references/triggering-sessions.md` | How a session actually fires: agent-enabled app, delegate/@mention, daemon+pump prerequisites, access control |

## Prerequisites (ops)

The cyrus daemon (`cyrus` on :3456) and a continuous SQS-mode pump must be running on
the devpod for delegations to drive sessions. See `references/triggering-sessions.md`
and the project memory `cyrus-local-running`.
