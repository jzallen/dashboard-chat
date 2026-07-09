# Linear structure, labels, routing, views

## Primitive mapping (one file each)

| Linear primitive | Maps to | Reference |
|---|---|---|
| **Project** | Proposals (intake) or a Feature (= nwave feature) | `project.md` |
| **Milestone** | a **Release** (shippable increment; 1:many stories) | `milestone.md` |
| **Issue (story)** | an nwave **story** — `wave › distill`, decomposes into tasks | `story.md` |
| **Sub-issue (task)** | a build unit — `wave › deliver`, one PR; AC checklist = tests | `task.md` |
| **Cycle** | optional WIP bound for solo cadence | — skip if it's overhead |

This file covers the cross-cutting **labels / routing / views**; see the per-level files
above for the workflow at each level.

## Label taxonomy

Labels do double duty — human filtering **and** cyrus behavior (`labelPrompts`).

### Grouped labels, not colon-form strings (read this first)

`wave` and `area` are Linear **label groups**. A group is itself a label (`isGroup`);
its members (`discuss`, `distill`, `backend`, …) are child labels with the group as their
`parentLabel`. **You apply a grouped label by applying the child — there is no separate
group field.** Applying the `discuss` child *is* "wave › discuss".

- **Never pass the colon-form string** (`"wave:discuss"`) to `save_issue` / `create_issue`.
  A flat, ungrouped label literally named `wave:discuss` may also exist; passing the string
  matches *that* footgun instead of the grouped child, which is why wave labels have been
  landing outside the group. Pass the **child label's ID** (unambiguous) or the **bare
  child name** (`"discuss"`, `"distill"`, `"backend"`) — never `"wave:discuss"`.
- Groups are **exclusive**: an issue holds at most one child per group. Applying `deliver`
  auto-removes `distill`, so the story phase-flag flips cleanly with a single label write.
- Written in prose as `wave › discuss` (or shorthand `wave/discuss`); the colon-form is
  reserved for the flat labels we are retiring (see the deletion caveat below).

**Child-label IDs** (the unambiguous form for `save_issue.labels`):

| Group | Child → ID |
|---|---|
| `wave` | `discuss` `fc52db45-fb20-40e4-933f-2ebe537a1f2c` · plus `design` `research` `document` `distill` `deliver` `bugfix` `refactor` `finalize` |
| `area` | `ui` `303e96a4-c364-4533-80ee-be43adbc1fce` · `backend` `011b77b3-b324-4a7c-a1e0-266005ff5131` · `agent` `a7e794b3-4e71-4cba-ad5e-03e7315f7d10` · `ui-state` `c8b58096-ce9f-4988-9519-e72097a49bb9` · `auth-proxy` `b6cf512a-d4b7-4d03-a412-e12023d677b1` · `infra` `b8203301-d7e0-43c7-9dea-ea228d933c3f` |

Look the rest up with `list_issue_labels(name: "<child>")` (returns the child with its
`parent`), not from memory.

> **Deletion caveat.** A redundant *flat* set (`wave:discuss`, `area:ui`, …) still exists
> alongside the groups and is the source of the mis-grouping. Delete the flat set in Linear
> Settings → Labels (there is no MCP tool for label deletion, so this is a manual one-time
> cleanup). Until then, only the grouped-child form is safe.

### `wave` group — drives the cyrus mode + tool scope
| Child | nwave entry | cyrus tool scope |
|---|---|---|
| `discuss` | `/nw-discuss` | `readOnly` — posts stories/AC to thread |
| `design` | `/nw-design` | `readOnly` — C4/ADRs |
| `research` | `/nw-research` | `readOnly` |
| `document` | `/nw-document` | `readOnly` |
| `distill` | orchestrator mode | `coordinator` (read + create Linear sub-issues, **no code edits**) — decomposes a story into a Skeleton task + impl tasks |
| `deliver` | `/nw-deliver` | `all` — builder; on a **story** it delivers the whole story in one session (one story PR) |
| `bugfix` | `/nw-bugfix` | `safe`/`all` |
| `refactor` | `/nw-refactor` | `safe`/`all` — behaviour-preserving; targeted by RPP level + scope |
| `finalize` | `/nw-finalize` | write-capable — closes a project out from the migrated seed issue under its Finalize milestone (`milestone.md`); assigned **manually** when all Releases are Done |

Read-only waves are safe to fire liberally — they cannot touch production code.
`deliver | bugfix | refactor | finalize` are the gated ones (they write / open PRs). For
**which** wave a given task wants — especially **`deliver` (behaviour-adding) vs `refactor`
(behaviour-preserving, RPP level + scope targeted)** — see `choosing-waves.md`.

**On a story, the wave child is a phase flag:** `distill` (awaiting breakdown,
orchestrator) → relabel `deliver` (approved, builder). Mode is read from the story's
label, so flipping it is how you move from planning to building (see `story.md`); group
exclusivity means the flip is a single label write. Task sub-issues stay `deliver` as the
plan — they're never individually delegated.

### `area` group — subtree filtering (mirrors the CI gate's subtree routing)
`ui` (the `ui/` frontend tree), `backend`, `agent`, `ui-state`, `auth-proxy`, `infra`.
Also the primary signal for **parallel-safety** (see `parallel-execution.md`). (The `ui`
child was renamed from `frontend` 2026-06-15 when the legacy `frontend/` tree was removed
in favor of `ui/`.)

### `test:unit` / `test:integration`
Optional **descriptors on a task** indicating which test types its AC checklist
contains (handy for filtering). No longer a separate issue level.

## Routing (cyrus)

- **`teamKeys` catch-all.** Single team → configure the repo's `teamKeys` with this
  team's key so **every** issue auto-routes to `dashboard-chat`. This frees labels
  for wave/area meaning instead of repo selection. (Routing priority is
  `routingLabels` > `projectKeys` > `teamKeys`; we deliberately use the lowest,
  broadest tier.)
- **`labelPrompts`** maps each `wave` child label → an AI mode + `allowedTools` preset
  (`readOnly` / `safe` / `all`). This is the lever that makes a label mean "run this
  wave under these guardrails." (cyrus has no per-label *model* selection — only tool
  scope varies by label.) A new wave child (e.g. `finalize`) needs its `labelPrompts`
  entry added before it routes.
- The issue **description is the agent's task prompt**. The canonical body shapes live in
  Linear **native templates** for the primitives a human authors, and in the per-level
  reference files for the ones an agent builds via the MCP — see `templates.md`. Each body
  opens with the matching `/nw-*` command so "good issue hygiene" and "good agent prompt"
  are the same habit, and follows `issue-authoring.md`: human-readable title + summary, an
  `## AGENT NOTES` section for the agent-facing instructions, `## References` at the bottom.

## Suggested views

- **Triage** — no `wave:` label; needs wave + area before delegating.
- **Ready to delegate** — `wave:*` set, status Todo.
- **In Review** — your PR review queue (Linear diffs).
- **Needs human / blocked** — blocked, or a session escalated.
- **Per-`area` boards** — at-a-glance subtree load; doubles as a parallel-batch picker.
