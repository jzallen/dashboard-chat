# Intake & promotion

How a raw idea becomes a structured feature, and who does which part.

## The funnel

```
Proposals project
  └ Proposal issue (wave:discuss)
        │   delegate dc-cyrus → nw-discuss
        ▼
     proposal enriched + Story sub-issues added (JTBD, stories, AC)
        │   [main session] PROMOTE
        ▼
  New Feature project
    + git feature/<slug> branch
    + Release milestones (from the discuss release-slicing)
    + stories moved in (on their Release milestone, wave:distill)
        │   per story: delegate dc-cyrus → nw-distill  → task sub-issues (wave:deliver)
        │   per task:  delegate dc-cyrus → nw-deliver  → PR into feature branch
        ▼
     review + merge in Linear; Release done → feature branch → main
```

## Division of labor (set by tool capability)

| Actor | Linear MCP | Owns |
|---|---|---|
| **dc-cyrus** | issue-only (`create_issue`/`update_issue`/`get_issue`/`save_comment`) | the **waves** in-session: `nw-discuss` (→ stories), `nw-distill` (→ tasks), `nw-deliver` (→ code) |
| **main-session assistant** | full (`save_project`, `save_milestone`, `save_issue`) | the **structure**: create/manage projects + Release milestones, **promotion**, cut the feature branch |

**cyrus thinks; the main session structures.** cyrus literally can't create projects or
milestones (no tools for it — that's why DC-6 came back with no project/milestone), so
those never block on it.

## Promotion mechanics (main session)

There's no single "convert issue → project" API call, so the main session **replicates**
it via the full Linear MCP:

1. `save_project` — create the Feature project (name = feature slug, team = DC), seed
   the description from the proposal.
2. `save_milestone` (×N) — create the Release milestones from the discuss release-slicing
   (`Release 1` = walking skeleton).
3. `save_issue` (per story) — **move** the existing story sub-issues into the Feature
   project + their Release milestone (pass `id` to move, so IDs/history/comments
   survive — do NOT recreate), set `wave:distill` + `area:*`.
4. Cut the git branch: `git branch feature/<slug> main && git push -u origin …`.
5. Leave the original proposal issue in Proposals as the record (link or close it).

Then hand each story to dc-cyrus (`nw-distill`), and each resulting task (`nw-deliver`).

## When to skip the funnel

For a small, obvious change you don't need the Proposals → promotion path — create a
Feature project (or reuse one) directly, add the story, and distill. The funnel earns its
keep for genuinely new, multi-story features that need discussion first.
