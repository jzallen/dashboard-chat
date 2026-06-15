# Project level

Two kinds of Linear project exist in this workflow.

## Proposals project (standing intake)

One long-lived **Proposals** project holds **discussion-topic issues** (proposals),
each labeled `wave:discuss`. No milestones live here.

- **You** add a proposal issue (the topic / problem to explore).
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
- the promoted **stories** (moved in from the proposal, labeled `wave:distill`,
  assigned to a Release).

The project description holds the brief; the stories carry the detail.

## Who creates/manages projects

**The main-session assistant**, not cyrus. cyrus's built-in Linear MCP is **issue-only**
(`create_issue`/`get_issue`/`update_issue`/`save_comment`) — it **cannot** create
projects or milestones. The main session has the full Linear MCP (`save_project`,
`save_milestone`, `save_issue`), so all project/milestone structure — and the promotion —
is done from the main session. **cyrus thinks (waves); the main session structures.**
See `intake-and-promotion.md`.
