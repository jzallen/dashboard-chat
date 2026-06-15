# Linear structure, labels, routing, views

## Primitive mapping

| Linear primitive | Maps to | Notes |
|---|---|---|
| **Project** | nwave **feature** (`docs/feature/{slug}`) | Project doc = the brief/goal. Owns a `feature/<slug>` git branch. |
| **Milestone** | **slice** (`MR-1 … MR-N`) | Logical grouping of stories; no branch of its own. |
| **Orchestrator issue (story)** | the unit you delegate; it **decomposes** | `wave:distill` (orchestrator mode). Reads code, creates work sub-issues. Writes no code. |
| **Work sub-issue** | a **build unit** | `wave:deliver`. One cyrus session, one story branch, one PR into the feature branch. Its **AC checklist** is the test spec. Orchestrator must set its `project` + `projectMilestone` = the parent's (the API/MCP does **not** auto-inherit them — see `tdd-ac-checklist.md`). |
| **Cycle** | optional WIP bound for solo cadence | Skip if it's overhead. |

A work sub-issue's **acceptance criteria are a markdown checklist in its description**
— port-to-port, happy + error paths — NOT grandchild issues. Each checkbox is a test
the builder writes as an atomic commit; the checklist is the live RED→GREEN tracker
(see `tdd-ac-checklist.md`).

## Label taxonomy

Labels do double duty — human filtering **and** cyrus behavior (`labelPrompts`).

### `wave:*` — drives the cyrus mode + tool scope
| Label | nwave entry | cyrus tool scope |
|---|---|---|
| `wave:discuss` | `/nw-discuss` | `readOnly` — posts stories/AC to thread |
| `wave:design` | `/nw-design` | `readOnly` — C4/ADRs |
| `wave:research` | `/nw-research` | `readOnly` |
| `wave:document` | `/nw-document` | `readOnly` |
| `wave:distill` | orchestrator mode | `coordinator` (read + create Linear sub-issues, **no code edits**) — decomposes the story into work sub-issues with AC checklists |
| `wave:deliver` | `/nw-deliver` | `all` — implements the AC checklist test-first, opens PR |
| `wave:bugfix` | `/nw-bugfix` | `safe`/`all` |
| `wave:refactor` | `/nw-refactor` | `safe`/`all` |

Read-only waves are safe to fire liberally — they cannot touch production code.
`wave:deliver|bugfix|refactor` are the gated ones (they open PRs).

### `area:*` — subtree filtering (mirrors the CI gate's subtree routing)
`area:ui` (the `ui/` frontend tree), `area:backend`, `area:agent`, `area:ui-state`,
`area:auth-proxy`, `area:infra`. Also the primary signal for **parallel-safety** (see
`parallel-execution.md`). (`area:frontend` was renamed `area:ui` 2026-06-15 when the
legacy `frontend/` tree was removed in favor of `ui/`.)

### `test:unit` / `test:integration`
Optional **descriptors on a work sub-issue** indicating which test types its AC
checklist contains (handy for filtering). No longer a separate issue level.

## Routing (cyrus)

- **`teamKeys` catch-all.** Single team → configure the repo's `teamKeys` with this
  team's key so **every** issue auto-routes to `dashboard-chat`. This frees labels
  for wave/area meaning instead of repo selection. (Routing priority is
  `routingLabels` > `projectKeys` > `teamKeys`; we deliberately use the lowest,
  broadest tier.)
- **`labelPrompts`** maps each `wave:*` label → an AI mode + `allowedTools` preset
  (`readOnly` / `safe` / `all`). This is the lever that makes a label mean "run this
  wave under these guardrails." (cyrus has no per-label *model* selection — only tool
  scope varies by label.)
- The issue **description is the agent's task prompt**. Use per-wave issue templates
  whose body is already a good brief and opens with the matching `/nw-*` command, so
  "good issue hygiene" and "good agent prompt" are the same habit.

## Suggested views

- **Triage** — no `wave:` label; needs wave + area before delegating.
- **Ready to delegate** — `wave:*` set, status Todo.
- **In Review** — your PR review queue (Linear diffs).
- **Needs human / blocked** — blocked, or a session escalated.
- **Per-`area` boards** — at-a-glance subtree load; doubles as a parallel-batch picker.
