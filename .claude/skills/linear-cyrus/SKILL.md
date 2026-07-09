---
name: linear-cyrus
description: >
  Use when planning, organizing, or driving work through Linear with the cyrus
  Claude Code agent — running the Proposals→feature funnel, creating projects /
  Release milestones / stories / tasks, mapping nwave waves (discuss/distill/
  deliver) to Linear labels, promoting a proposal into a feature project,
  delegating sessions to @dashboard-chat, reviewing story PRs in Linear, or
  parallelizing work. Triggers: "linear", "cyrus", "proposal", "promote",
  "delegate the issue", "release branch", "skeleton", "decompose",
  "acceptance checklist", "agent session".
---

# Linear + Cyrus workflow

How we coordinate work on this repo: **Linear is the front door, cyrus is the
hands.** Planning, review, and merge live in Linear; cyrus turns a delegated issue
into a git worktree, runs a Claude Code session, and opens a GitHub PR you review and
merge **inside Linear** ([diffs](https://linear.app/docs/diffs)). This replaced the
gastown merge queue (retired 2026-06-15; parked in `.claude/retired-skills/gastown/`).

## Who does what — the core split

**cyrus thinks; the main session structures.** Tool-enforced:

- **dc-cyrus** has an **issue-only** Linear MCP → runs the **waves** (`nw-discuss`,
  `nw-distill`, `nw-deliver`). It **does create the task sub-issues** during `nw-distill`
  (`create_issue`); it **cannot** create projects or milestones (and creates no issues in
  read-only `nw-discuss`).
- The **main-session assistant** has the **full** Linear MCP (`save_project`,
  `save_milestone`, `save_issue`) → owns **structure**: projects, Release milestones +
  their git branches, **promotion**.

## The levels (one file each in `references/`)

```
Proposals project ── wave › discuss ──►  proposal enriched + stories as ANALYSIS in thread   (cyrus: nw-discuss, read-only)
      │  [main session] PROMOTE — the seed issue MIGRATES into the project
      ▼
Feature project   = nwave feature   (named for the natural code feature name)
  ├ Release (milestone)  → git <feature-slug>/<release> branch        (main session)
  │   └ Story  (issue)  ── phase flag: wave › distill → wave › deliver
  │       ·  wave › distill → cyrus decomposes into Task sub-issues + a Skeleton task first
  │       ·  (you review, relabel wave › deliver, @mention a comment)
  │       ·  wave › deliver → ONE builder session iterates the tasks → ONE story PR
  │           into the Release branch  (skeleton RED tests → green)
  └ Finalize (milestone) → holds the migrated seed issue = nw-finalize closeout handle
```

Labels are the **grouped** `wave`/`area` children — apply by child name/ID, never the
colon-form string (`references/linear-structure.md`).

- **Story label is a phase flag.** `wave › distill` (awaiting breakdown) runs the
  orchestrator; relabel `wave › deliver` to run the builder. Mode comes from the **story's**
  label (group exclusivity flips it in one write).
- **One PR per story** (story branch → Release branch); **no task branches/PRs** — tasks
  are the deliver session's plan, landed as commits. RED is transient on the story branch;
  the story PR gates the green end-state. Linear auto-generates a branch name for every
  sub-issue (Skeleton + impl tasks); **ignore it** — starting a session "on the Skeleton
  issue" still builds on the parent **story branch** (`branching-and-merge.md`).
- **Skeleton-first:** the first task scaffolds + stubs signatures + writes the AC checklist
  as honest **RED tests**; implementation tasks turn them green (`skeleton-task.md`).
- **Release → main with no PR** (already reviewed via story PRs). Milestone progress
  tracked at the **story** level.
- **Status automation:** branch → In Progress, PR → In Review, merge → Done.

## Canonical lifecycle

1. Add a **proposal** issue to the **Proposals** project (`wave › discuss`).
2. Delegate dc-cyrus → `nw-discuss` (read-only) **produces the stories as analysis in the
   thread** — it can't create issues; the main session materializes them at promotion.
3. **Promote** (main session): Feature project (named for the code feature) + **Release
   milestones + `<slug>/<release>` branches** + a **Finalize** milestone; **migrate the
   seed issue** into Finalize; create stories in (on their Release, `wave › distill`).
4. Per story: attach project + Release, then delegate dc-cyrus → `nw-distill` decomposes
   into a **Skeleton task + impl tasks** with AC checklists.
5. Review the breakdown → **relabel the story `wave › deliver`** → **@mention a story
   comment** → one builder session delivers the whole story (skeleton-first), **one PR**
   into the Release branch. As it goes, the session **moves each sub-issue's status by
   hand** (Todo → In Progress → Done) — the status automation only moves the *story*, not
   its tasks, so a delivered sub-issue left in Todo is a missed step (see `task.md`).
6. Review + merge the story PR in Linear. Release done → merge `<slug>/<release>` → `main`.
7. **All Releases done** → relabel the seed `wave › finalize` (manual) → delegate →
   `nw-finalize` archives to `docs/evolution/`, seed goes Done (see `intake-and-promotion.md`).

Parallelize **across stories** (each its own session into the Release branch), not
tasks-within-a-story — tasks share the skeleton (see `parallel-execution.md`).

## References

| File | Covers |
|---|---|
| `references/choosing-waves.md` | which `wave:*`/`/nw-*` to pick; **nw-deliver vs nw-refactor**; RPP levels + scope/flags |
| `references/issue-authoring.md` | titles/descriptions: human-readable name, `## AGENT NOTES`, `## References`, issue linking |
| `references/intake-and-promotion.md` | Proposals→feature funnel, cyrus-vs-main-session split, promotion mechanics |
| `references/project.md` | Proposals vs Feature projects; who creates them; `nw-discuss` |
| `references/milestone.md` | Milestone = Release; owns a git branch; 1:many stories; →main no-PR; **Finalize lifecycle milestone**; escape hatch |
| `references/story.md` | Story label as **phase flag** (`wave › distill`→`deliver`); **create-a-story runbook** (attach project+Release, delegate last); distill→review→deliver-via-comment |
| `references/skeleton-task.md` | the Skeleton task — scaffold + signatures + honest RED tests, per story, first |
| `references/task.md` | Task = the plan (no branches/PRs); skeleton vs implementation; atomic commits; **driving each sub-issue's status by hand (Todo→In Progress→Done)** |
| `references/branching-and-merge.md` | Release branches, **story-level PRs**, where the gate runs, →main no-PR, `baseBranch` caveat |
| `references/parallel-execution.md` | parallelize across stories; judging independence; conflict avoidance |
| `references/linear-structure.md` | **grouped-label** taxonomy (child name/ID, not colon-form), routing (`teamKeys` + `labelPrompts`/orchestrator), views |
| `references/templates.md` | canonical body shapes: **native templates** for human-authored primitives + reference shapes for agent-built ones; authoring loop; project-template specs; one-time Settings checklist |
| `references/triggering-sessions.md` | how a session fires: agent-enabled app, delegate + comment-@mention, daemon+pump, skills allowlist |

## Prerequisites (ops)

The cyrus daemon (`cyrus` on :3456) and a continuous SQS-mode pump must be running on the
devpod for delegations to drive sessions. See `references/triggering-sessions.md` and the
project memory `cyrus-local-running`.
