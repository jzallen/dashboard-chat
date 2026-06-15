# Intake & promotion

How a raw idea becomes a structured feature, and who does which part.

## The funnel

```
Proposals project
  └ Proposal issue (wave:discuss)
        │   delegate dc-cyrus → nw-discuss
        ▼
     proposal enriched + stories produced as ANALYSIS in the thread (JTBD, stories, AC)
        │   [main session] PROMOTE
        ▼
  New Feature project
    + Release milestones (from the discuss release-slicing) + a git <slug>/<release> branch each
    + stories moved in (on their Release milestone, wave:distill)
        │   per story: assign dc-cyrus → nw-distill → Skeleton task + impl tasks (wave:deliver)
        │   review breakdown → relabel story wave:deliver → @mention comment
        │   → ONE builder session delivers the whole story → ONE story PR into the Release branch
        ▼
     review + merge story PRs in Linear; Release done → <slug>/<release> → main (no PR)
```

## Division of labor (set by tool capability)

| Actor | Linear MCP | Owns |
|---|---|---|
| **dc-cyrus** | issue-only (`create_issue`/`update_issue`/`get_issue`/`save_comment`) | the **waves** in-session: `nw-discuss` (→ stories **as thread analysis** — read-only mode, no issue creation), `nw-distill` (→ task sub-issues — coordinator mode), `nw-deliver` (→ code) |
| **main-session assistant** | full (`save_project`, `save_milestone`, `save_issue`) | the **structure**: create/manage projects + Release milestones + their git branches, **promotion** |

**cyrus thinks; the main session structures.** cyrus literally can't create projects or
milestones (no tools for it — that's why DC-6 came back with no project/milestone), so
those never block on it.

## Promotion mechanics (main session)

There's no single "convert issue → project" API call, so the main session **replicates**
it via the full Linear MCP:

1. `save_project` — create the Feature project (name = feature slug, team = DC), seed
   the description from the proposal.
2. `save_milestone` (×N) — create the Release milestones from the discuss release-slicing
   (`Release 1` = the first / thinnest increment — NOT a "walking skeleton"; that's the
   per-story Skeleton task).
3. `save_issue` (per story) — **create** the story issues in the Feature project from the
   discuss analysis (the thread is read-only output, so there are no story sub-issues to
   move): `team` = DC, `project`, `milestone` = its Release, `wave:distill` + `area:*`.
4. Cut a git branch **per Release**: `git branch <slug>/release-1 main && git push -u
   origin <slug>/release-1` (story PRs target it; later Releases rebase on `main` after
   the prior one merges — see `branching-and-merge.md`).
5. Leave the original proposal issue in Proposals as the record (link or close it).

Then per story: assign dc-cyrus (`nw-distill`) to decompose, review, relabel
`wave:deliver`, and @mention a comment to deliver the whole story in one session (see
`story.md`).

## When to skip the funnel

For a small, obvious change you don't need the Proposals → promotion path — create a
Feature project (or reuse one) directly, add the story, and distill. The funnel earns its
keep for genuinely new, multi-story features that need discussion first.
