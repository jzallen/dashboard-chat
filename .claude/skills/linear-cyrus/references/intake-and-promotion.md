# Intake & promotion

How a raw idea becomes a structured feature, and who does which part. Two standing backlog
projects hold ideas — **Proposals** (new features) and **Tech Debt** (debt intake) — and
both promote into feature/refactor projects the same way: the seed issue **migrates into
the promoted project** rather than being left behind.

## The funnel

```
Proposals project
  └ Proposal issue (wave › discuss)
        │   delegate dc-cyrus → nw-discuss
        ▼
     proposal enriched + stories produced as ANALYSIS in the thread (JTBD, stories, AC)
        │   [main session] PROMOTE
        ▼
  New Feature project (named for the natural code feature name)
    + Release milestones (from the discuss release-slicing) + a git <slug>/<release> branch each
    + Finalize milestone  ← the migrated seed issue lands here (project closeout handle)
    + stories created in (on their Release milestone, wave › distill)
        │   per story: create → attach project + Release → delegate dc-cyrus → nw-distill → Skeleton + impl tasks
        │   review breakdown → relabel story wave › deliver → @mention comment
        │   → ONE builder session delivers the whole story → ONE story PR into the Release branch
        ▼
     review + merge story PRs in Linear; Release done → <slug>/<release> → main (no PR)
        │   ALL Releases done → relabel the seed wave › finalize → delegate → nw-finalize
        ▼
     project closed out (artifacts archived to docs/evolution/); seed issue Done
```

## Division of labor (set by tool capability)

| Actor | Linear MCP | Owns |
|---|---|---|
| **dc-cyrus** | issue-only (`create_issue`/`update_issue`/`get_issue`/`save_comment`) | the **waves** in-session: `nw-discuss` (→ stories **as thread analysis** — read-only mode, no issue creation), `nw-distill` (→ task sub-issues — coordinator mode), `nw-deliver` (→ code), `nw-finalize` (→ closeout) |
| **main-session assistant** | full (`save_project`, `save_milestone`, `save_issue`) | the **structure**: create/manage projects + milestones + their git branches, **promotion**, migrating the seed |

**cyrus thinks; the main session structures.** cyrus literally can't create projects or
milestones (no tools for it — that's why DC-6 came back with no project/milestone), so
those never block on it.

## Promotion mechanics (main session)

There's no single "convert issue → project" API call, so the main session **replicates**
it via the full Linear MCP. Fill each primitive from its shape (native template for the
human-authored ones, the per-level reference for the agent-built ones — see `templates.md`),
and apply labels by **grouped child name/ID, never the colon-form** (`linear-structure.md`):

1. `save_project` — create the Feature project. **Name it for the natural feature name from
   the code** (a plain product name; no wave/artifact/ticket vocabulary), team = DC. The
   description is human-readable prose that **synthesizes** the discuss outcome (not a
   verbatim quote of the analysis docs), with an `## AGENT NOTES` section and a
   bibliography-style `## References` block last (see `project.md`, `issue-authoring.md`).
2. `save_milestone` (×N) — create the Release milestones from the discuss release-slicing
   (`Release 1` = the first / thinnest increment — NOT a "walking skeleton"; that's the
   per-story Skeleton task).
3. `save_milestone` (×1) — create the **Finalize milestone**, ordered last. It is a
   *lifecycle* milestone, not a slice (the one exception to one-milestone-per-slice — see
   `milestone.md`).
4. **Migrate the seed issue** — `save_issue(id: <proposal>, project: <feature>,
   milestone: "Finalize")` to move the originating proposal out of Proposals and into the
   new project under Finalize. It becomes the **closeout handle** (agent surface for
   `nw-finalize`); do not leave or close it in the backlog. This is what prevents the
   lingering-seed symptom (an orphaned proposal stuck `In Progress` with an idle worktree).
5. `save_issue` (per story) — **create** the story issues from the discuss analysis (the
   thread is read-only output, so there are no story sub-issues to move): `team` = DC,
   `project`, `milestone` = its Release, labels `distill` + area child. Human-readable
   title (no wave/tier/relationship tags) and a body that **synthesizes** the story from
   the analysis with an `## AGENT NOTES` block (see `story.md`) — the issue body is the
   agent's prompt; without it the deliver agent skips distill and implements directly. See
   the create-a-story sequence in `story.md` (attach project + Release, then delegate last).
6. Cut a git branch **per Release**: `git branch <slug>/release-1 main && git push -u
   origin <slug>/release-1` (story PRs target it; later Releases rebase on `main` after
   the prior one merges — see `branching-and-merge.md`).

nwave artifacts (JTBD, journeys, ADRs, roadmaps) **stay in the codebase** — never attach
them to Linear as comments or documents. When a description needs to point at one, name it
in the `## References` block.

Then per story: assign dc-cyrus (`nw-distill`) to decompose, review, relabel `deliver`,
and @mention a comment to deliver the whole story in one session (see `story.md`).

## Closeout (the terminal transition)

When **all Release milestones are Done**, the seed issue under Finalize is delegated:
relabel it `wave › finalize` (assigned **manually** — it does not auto-fire) and delegate
dc-cyrus. `nw-finalize` archives the feature's artifacts to `docs/evolution/` and does the
project-level wrap-up; the seed goes **Done**, which is what makes its worktree prunable.

## Tech Debt intake & promotion

The **Tech Debt** project is the standing intake for debt (mirrors Proposals). Membership
in the project *is* the marker — no separate label axis. A debt issue is authored from the
Tech Debt intake template (`templates.md`). Two promotion paths:

- **Light (single actionable item).** Most debt is one behaviour-preserving cleanup. Detach
  it from the Tech Debt project, relabel `refactor` + its area child, and delegate dc-cyrus
  → `nw-refactor <path> --level=N --scope=…` (`choosing-waves.md`). No project needed. A
  **generator** debt issue (one that surveys an area and spawns sibling items) produces
  those as **parentless standalone** Refactor issues, not sub-issues; it goes Done once
  decomposed.
- **Heavy (earns its own project).** A multi-module / multi-level cleanup promotes like a
  proposal: create a **Refactor project** from its template, migrate the seed under a
  Finalize milestone, and add **Refactor issues** (each carrying its level + scope) — not
  Stories; refactor is behaviour-preserving and has no AC-checklist / skeleton frame
  (`choosing-waves.md`). Slice with Release milestones if the RPP cascade or Mikado phases
  warrant it.

## When to skip the funnel

For a small, obvious change you don't need the Proposals → promotion path — create a
Feature project (or reuse one) directly, add the story, and distill. The funnel earns its
keep for genuinely new, multi-story features that need discussion first.
