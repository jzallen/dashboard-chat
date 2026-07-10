# Project level

Two kinds of Linear project exist in this workflow.

## Proposals project (standing intake)

One long-lived **Proposals** project holds **discussion-topic issues** (proposals),
each labeled `wave › discuss`. No milestones live here.

- **You** add a proposal issue (the topic / problem to explore).
- **Delegate dc-cyrus** → it runs `nw-discuss` (read-only) and **produces** the JTBD /
  user stories / acceptance criteria **as analysis in the issue thread**. It does NOT
  create issues (readOnly mode has no `create_issue`) — the main session materializes the
  stories as issues at promotion.
- A validated proposal is then **promoted** to its own Feature project (see
  `intake-and-promotion.md`).

## Feature project (one per feature)

A **Feature project** = one nwave **feature**. Created at **promotion** time. **Name it for
the natural feature name from the code** — a plain product name a human recognizes, with no
wave/artifact/ticket vocabulary. It owns:

- **Release milestones**, each with its own git **`<slug>/<release>` branch** (see
  `milestone.md` + `branching-and-merge.md`) — there's no single feature branch,
- one **Finalize milestone** (ordered last) holding the **migrated seed issue** — the
  project closeout handle for `nw-finalize` (see `milestone.md`),
- the promoted **stories** (created at promotion from the discuss analysis, labeled
  `distill` + area child, assigned to a Release).

The project **description** is human-readable prose that **synthesizes** the outcome of the
pre-distill waves (goal, scope, release-slicing) — not a verbatim quote of the analysis
docs — followed by an `## AGENT NOTES` section and a bibliography-style `## References`
block last for any file/artifact/issue pointers (see `issue-authoring.md`). The stories
carry the detail. nwave artifacts stay in the codebase; reference them, don't attach them.

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
