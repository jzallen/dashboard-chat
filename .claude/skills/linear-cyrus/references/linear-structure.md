# Linear structure, labels, routing, views

## Primitive mapping (one file each)

| Linear primitive | Maps to | Reference |
|---|---|---|
| **Project** | Proposals (intake) or a Feature (= nwave feature) | `project.md` |
| **Milestone** | a **Release Slice** (from `slices/`; carries slice AC; 1:many stories) | `milestone.md` |
| **Issue (Release Slice)** | the slice-AC **checklist surface**; not delegated | `milestone.md` |
| **Issue (story)** | an nwave **user story** — validation surface, grouped onto a slice; not delegated | `story.md` |
| **Issue (scenario)** | a roadmap **step** = the codegen unit — `wave › deliver`, scenario branch → squash into feature | `scenario.md` |
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

- **Pass the bare child name** (`"discuss"`, `"distill"`, `"backend"`, …) to `save_issue` /
  `create_issue`. **Never pass the colon-form string** (`"wave:discuss"`): a flat, ungrouped
  label literally named `wave:discuss` may also exist, and the string matches *that* footgun
  instead of the grouped child — which is why wave labels have been landing outside the group.
- **Validate before trusting the name.** `list_issue_labels(name: "<child>")` should return
  a single label whose `parent` is the expected group (`wave` for `distill`, `area` for
  `backend`, …). If it does, the bare name is safe. **Only if** the name is missing,
  duplicated, or resolves without the right parent, look up that label's surrogate id and
  pass the **id** instead — don't hard-code ids in prose or templates, they rot.
- Groups are **exclusive**: an issue holds at most one child per group. Applying `deliver`
  auto-removes `distill`, so the story phase-flag flips cleanly with a single label write.
- Written in prose as `wave › discuss` (or shorthand `wave/discuss`); the colon-form is
  reserved for the flat labels we are retiring (see the deletion caveat below).

The children: `wave` → `discuss` `design` `research` `document` `distill` `deliver`
`bugfix` `refactor` `finalize`; `area` → `ui` `backend` `agent` `ui-state` `auth-proxy`
`infra`. Confirm each resolves under its group with `list_issue_labels` rather than
trusting this list from memory.

> **Deletion caveat.** A redundant *flat* set (`wave:discuss`, `area:ui`, …) still exists
> alongside the groups and is the source of the mis-grouping. Delete the flat set in Linear
> Settings → Labels (there is no MCP tool for label deletion, so this is a manual one-time
> cleanup). Until then, only the grouped-child form is safe.

### `wave` group — drives the cyrus mode + tool scope
The pre-promotion waves (`discuss`/`design`/`distill`/`deliver`) run on the **proposal** issue
and are **write-capable** — they commit artifacts to the proposal's branch. (This is the change
from the old model, where `discuss` was read-only thread analysis.)

| Child | nwave entry | cyrus tool scope |
|---|---|---|
| `discuss` | `/nw-discuss` | **write-capable** — commits `user-stories.md`, `story-map.md`, `slices/` |
| `design` | `/nw-design` | **write-capable** — commits ADRs / C4 / domain model |
| `distill` | `/nw-distill` | **write-capable** — commits the `.feature` acceptance suite |
| `deliver` | `/nw-deliver` (proposal: **partial**; scenario: `/nw-execute`) | `all` — on the **proposal** generates `roadmap.json` only then stops; on a **scenario** runs `/nw-execute <slug> <step-id>` for one step |
| `research` | `/nw-research` | `readOnly` |
| `document` | `/nw-document` | `readOnly` |
| `bugfix` | `/nw-bugfix` | `safe`/`all` |
| `refactor` | `/nw-refactor` | `safe`/`all` — behaviour-preserving; targeted by RPP level + scope |
| `finalize` | `/nw-finalize` | write-capable — closes a project out from the migrated seed issue under its Finalize milestone (`milestone.md`); assigned **manually** when all Release PRs are merged |

Read-only waves are safe to fire liberally — they cannot touch production code.
`deliver | bugfix | refactor | finalize` are the gated ones (they write / open PRs). For
**which** wave a given task wants — especially **`deliver` (behaviour-adding) vs `refactor`
(behaviour-preserving, RPP level + scope targeted)** — see `choosing-waves.md`.

**The wave child is a phase flag on the PROPOSAL:** cycle it `discuss → design → distill →
deliver`, delegating at each, to run the pre-promotion wave chain (`intake-and-promotion.md`);
group exclusivity means each flip is a single label write. After promotion, **Scenario** issues
carry a static `deliver` (each delivered via `/nw-execute`); **Story** and **Release Slice**
issues carry **no `wave` label** — they are validation surfaces and must not be delegatable into
a build (`story.md`, `milestone.md`).

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
