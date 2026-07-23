# Project level

Two kinds of Linear project exist in this workflow.

## Proposals project (standing intake)

One long-lived **Proposals** project holds **discussion-topic issues** (proposals), each
starting at `wave › discuss`. No milestones live here.

- **You** add a proposal issue (the topic / problem to explore).
- **Delegate dc-cyrus** and cycle the wave flag `discuss → design → distill → deliver`. Unlike
  the old read-only discuss, these are **write-capable** sessions that **commit artifacts to the
  proposal's branch** (`docs/feature/{slug}/…`, the `.feature` suite, and `roadmap.json`) — see
  `intake-and-promotion.md`. Partial-deliver stops after `roadmap.json` (no code).
- A validated proposal is then **promoted** to its own Feature project.

## Feature project (one per feature)

A **Feature project** = one nwave **feature**. Created at **promotion**. **Name it for the
natural feature name from the code** — a plain product name, no wave/artifact/ticket vocabulary.
It owns:

- **Release-Slice milestones** (from `slices/`), each with a **Release Slice issue** carrying
  the slice AC (`milestone.md`),
- **Story issues** (from `user-stories.md` grouping via `story-map.md`) — validation surfaces
  (`story.md`),
- **Scenario issues** (from `roadmap.json` steps) — the codegen units (`scenario.md`),
- one **Finalize milestone** holding the **migrated seed issue**,
- **exactly one git branch** — the **proposal's branch**, reused as the feature branch. There
  are **no per-Release integration branches** (`branching-and-merge.md`).

The project **description** synthesizes the pre-distill outcome (goal, scope, slicing) in fresh
prose — not a quote of the analysis — then `## AGENT NOTES` and a `## References` block last
(`issue-authoring.md`). nwave artifacts stay in the codebase; reference them, don't attach them.

## Who creates what

cyrus's Linear MCP is **issue-scoped**, but in the new model it **does not create issues during
the build** — scenarios come from `roadmap.json` and are minted by the main session at
promotion. The split:

| Level | Creator |
|---|---|
| Project, Release-Slice milestones | **main session** (full MCP: `save_project` / `save_milestone`) |
| Release Slice issues, Story issues, Scenario issues | **main session**, at promotion (from committed artifacts) |
| The committed **artifacts** (docs, `.feature`, `roadmap.json`) | **dc-cyrus**, during the pre-promotion wave chain |
| Code (per scenario) | **dc-cyrus**, `/nw-execute` per scenario issue |

So cyrus **produces the artifacts and the code**; the **main session mints all the Linear
structure** from those artifacts. See `intake-and-promotion.md`.
