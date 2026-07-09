# Project level

Two kinds of Linear project exist in this workflow.

## Proposals project (standing intake)

One long-lived **Proposals** project holds **discussion-topic issues** (proposals),
each labeled `wave:discuss`. No milestones live here.

- **You** add a proposal issue (the topic / problem to explore) — fill in
  `templates/proposal.md`.
- **Delegate dc-cyrus** → it runs `nw-discuss` (read-only) and **produces** the JTBD /
  user stories / acceptance criteria **as analysis in the issue thread**. It does NOT
  create issues (readOnly mode has no `create_issue`) — the main session materializes the
  stories as issues at promotion.
- A validated proposal is then **promoted** to its own Feature project (see
  `intake-and-promotion.md`).

## Feature project (one per feature)

A **Feature project** = one nwave **feature**. Created at **promotion** time, it owns:

- **Release milestones**, each with its own git **`<slug>/<release>` branch** (see
  `milestone.md` + `branching-and-merge.md`) — there's no single feature branch,
- the promoted **stories** (created at promotion from the discuss analysis, labeled
  `wave:distill`, assigned to a Release).

The project description holds the brief; the stories carry the detail. Seed it from
`templates/project.md`.

## Who creates what

cyrus's built-in Linear MCP is **issue-only** (`create_issue` / `get_issue` /
`update_issue` / `save_comment`), so the split is by Linear level:

| Level | Creator |
|---|---|
| Project, Release milestones (+ their git branches) | **main session** (full MCP: `save_project`/`save_milestone`) |
| **Stories** | **main session**, at promotion (from the discuss analysis) |
| **Task sub-issues** | **dc-cyrus**, during **`nw-distill`** — it *does* create the Skeleton task + impl sub-issues (orchestrator/coordinator mode, `create_issue`) |

So cyrus **can and does** create issue-level structure (the task sub-issues at distill);
it just **cannot** create projects or milestones, and in `nw-discuss` (read-only mode) it
can't create any issues. **cyrus thinks (waves) + creates the task sub-issues; the main
session creates the project/milestone/story scaffolding.** See `intake-and-promotion.md`.
