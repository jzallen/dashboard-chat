# Linear structure, labels, routing, views

## Primitive mapping (one file each)

| Linear primitive | Maps to | Reference |
|---|---|---|
| **Project** | Proposals (intake) or a Feature (= nwave feature) | `project.md` |
| **Milestone** | a **Release** (shippable increment; 1:many stories) | `milestone.md` |
| **Issue (story)** | an nwave **story** — `wave:distill`, decomposes into tasks | `story.md` |
| **Sub-issue (task)** | a build unit — `wave:deliver`, one PR; AC checklist = tests | `task.md` |
| **Cycle** | optional WIP bound for solo cadence | — skip if it's overhead |

This file covers the cross-cutting **labels / routing / views**; see the per-level files
above for the workflow at each level.

## Label taxonomy

Labels do double duty — human filtering **and** cyrus behavior (`labelPrompts`).

### `wave:*` — drives the cyrus mode + tool scope
| Label | nwave entry | cyrus tool scope |
|---|---|---|
| `wave:discuss` | `/nw-discuss` | `readOnly` — posts stories/AC to thread |
| `wave:design` | `/nw-design` | `readOnly` — C4/ADRs |
| `wave:research` | `/nw-research` | `readOnly` |
| `wave:document` | `/nw-document` | `readOnly` |
| `wave:distill` | orchestrator mode | `coordinator` (read + create Linear sub-issues, **no code edits**) — decomposes a story into a Skeleton task + impl tasks |
| `wave:deliver` | `/nw-deliver` | `all` — builder; on a **story** it delivers the whole story in one session (one story PR) |
| `wave:bugfix` | `/nw-bugfix` | `safe`/`all` |
| `wave:refactor` | `/nw-refactor` | `safe`/`all` |

Read-only waves are safe to fire liberally — they cannot touch production code.
`wave:deliver|bugfix|refactor` are the gated ones (they open PRs).

**On a story, the `wave:*` label is a phase flag:** `wave:distill` (awaiting breakdown,
orchestrator) → relabel `wave:deliver` (approved, builder). Mode is read from the story's
label, so flipping it is how you move from planning to building (see `story.md`). Task
sub-issues stay `wave:deliver` as the plan — they're never individually delegated.

### `area:*` — subtree filtering (mirrors the CI gate's subtree routing)
`area:ui` (the `ui/` frontend tree), `area:backend`, `area:agent`, `area:ui-state`,
`area:auth-proxy`, `area:infra`. Also the primary signal for **parallel-safety** (see
`parallel-execution.md`). (`area:frontend` was renamed `area:ui` 2026-06-15 when the
legacy `frontend/` tree was removed in favor of `ui/`.)

### `test:unit` / `test:integration`
Optional **descriptors on a task** indicating which test types its AC checklist
contains (handy for filtering). No longer a separate issue level.

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
