# Templates — canonical shapes for each primitive

Every proposal / project / story / slice / scenario / debt item has a **canonical body shape**
so good issue hygiene is the path of least resistance. Two surfaces carry those shapes, split by
**who creates the primitive**:

- **Human-authored** primitives (Proposal, Tech Debt intake, Refactor, Bug-fix) → **Linear
  native team templates**. Pick the template in the UI (or its unique email address) and the
  body/labels/defaults pre-fill. Needs no in-repo file.
- **Main-session-built** primitives (Release Slice, Story, Scenario issues at promotion) → the
  **per-level reference files** are the shape the main session fills via `save_issue`. The MCP
  **cannot apply a Linear template** (no `templateId` argument), so their shape lives here.

Keep native templates and reference shapes in sync.

> ⚠️ **Migration note (old → new model).** The previously-shipped native templates encode the
> retired "story → Skeleton task + impl sub-issues → one story PR into the Release branch"
> model. They **must be re-saved** in the Linear UI to the shapes below. See the **Purge
> checklist** at the bottom — the MCP cannot edit templates, so this is manual.

## What a Linear template can preset (and can't)

A **team** issue template presets team, status, priority, assignee, **delegated agent**,
project, labels, estimate, sub-issues, and has a **unique email address** that applies it on
create. It **cannot** be applied through the API/MCP, and it can't target a specific
**milestone** — so milestone assignment is always an explicit post-create step. Project
templates have no email affordance and are created by hand in Settings.

## Which shape lives where

| Primitive | Creator | Shape / template |
|---|---|---|
| **Proposal issue** | human | native template — below |
| **Tech Debt intake issue** | human | native template — below (unchanged) |
| **Refactor issue** | human / main session | native template — below (unchanged) |
| **Bug-fix issue** | human | native template — below (unchanged) |
| **Release Slice issue** | main session (at promotion) | `milestone.md` + below |
| **Story issue** | main session (at promotion) | `story.md` + below |
| **Scenario issue** | main session (at promotion) | `scenario.md` + below |
| **Feature project** | main session (at promotion) | spec below + `project.md` |

Placeholders: `{{token}}` = mechanical substitution (`{{feature-slug}}`, `{{area}}`,
`{{slice-n}}`, `{{step-id}}`); `<free prose>` = author writes it. Labels are grouped
`wave`/`area` **children** applied by validated child name, never colon-form
(`linear-structure.md`).

---

## Proposal issue  (labels: `wave › discuss`, `area › {{area}}`)

```
<1–3 sentences: the problem or opportunity to explore, and why it matters now. No solution
yet — a topic to discuss, not a plan.>

## What we'd want to learn
- <open question the discussion should settle>

## AGENT NOTES
Reference the `linear-cyrus` skill. This proposal runs the FULL pre-promotion wave chain,
committing artifacts to this issue's branch (which becomes the feature branch). Cycle the
`wave` flag and run each in order: `discuss` → `nw-discuss` (user-stories.md, story-map.md,
slices/), `design` → `nw-design`, `distill` → `nw-distill` (the .feature suite), `deliver` →
PARTIAL `nw-deliver` (generate roadmap.json ONLY, then STOP — no code). All are write-capable.
The main session promotes after roadmap.json exists. Do NOT create Linear issues.

## References
- <related ADR / docs pointer / Linear id>
```

## Release Slice issue  (labels: `area › {{area}}`; NO wave label; not delegated)

```
<1 sentence: the slice goal, from slices/slice-{{slice-n}}-*.md.>

## Slice acceptance criteria
- [ ] <the slice's own AC, from the brief — cross-cutting invariants, not the union of story AC>

## AGENT NOTES
Validation surface for Release Slice {{slice-n}} — NOT delegated, generates no code. Its AC are
verified independently once all this slice's Stories are complete (verification.md). Story work
lands via the Scenario issues; this issue tracks the slice-level AC only.

## References
- docs/feature/{{feature-slug}}/slices/slice-{{slice-n}}-*.md
```

## Story issue  (labels: `area › {{area}}`; NO wave label; not delegated)

```
<1–3 sentences synthesizing what this story delivers and why — plain language, not a quote of
user-stories.md.>

## Acceptance criteria
- [ ] **Given** <context> **when** <action> **then** <observable outcome>

## AGENT NOTES
Validation surface — do NOT implement from this issue. Code is delivered by the linked Scenario
issues (one per roadmap step, `/nw-execute`). As scenarios merge, their sessions check the AC
above that they satisfy (agent judgment — verification.md). This story's AC come from
user-stories.md; the slice's AC live on the Release Slice issue.

## References
- docs/feature/{{feature-slug}}/discuss/user-stories.md · related Linear ids (slice, scenarios)
```

## Scenario issue  (labels: `wave › deliver`, `area › {{area}}`; no milestone)

```
<1–2 sentences: the observable behaviour this step delivers — from the roadmap step criteria.>

## AGENT NOTES
Reference the `linear-cyrus` skill. Run `/nw-execute {{feature-slug}} {{step-id}}` to drive this
roadmap step's acceptance scenario RED → GREEN. Base your worktree on and open your PR into the
FEATURE branch `{{feature-branch}}` (NOT main) — squash-merge. On merge, mark this scenario
`related to` the Story/AC it satisfies and check those Story AC boxes. Iron Rule: do not weaken
or skip the .feature scenario to go green.

## References
- roadmap.json step {{step-id}} · tests/.../{{feature-slug}}/acceptance/<file>.feature
```

## Tech Debt intake / Refactor / Bug-fix issues (unchanged)

The debt/refactor/bug-fix path does **not** use the slice/story/scenario frame — keep the
existing native templates. Their AGENT NOTES already point at `nw-refactor` / `nw-bugfix` and
do not reference skeleton tasks or story PRs. (If any still mention "Skeleton task" or "story PR
into the Release branch," fix that line — see the Purge checklist.)

---

## Feature project — template spec  (create by hand in Settings)

- **Name:** the natural feature name from the code (no wave/artifact/ticket vocabulary).
- **Milestones:** the Release Slices, plus a **Finalize** milestone ordered last (`milestone.md`).
- **Description:**

```
<1–3 sentences synthesizing the feature goal — the outcome and for whom.>

## Scope
- <what's included>  · <explicit non-goal>

## AGENT NOTES
Promoted from a proposal. Release-Slice milestones + their Slice issues carry slice AC; Story
issues (validation surfaces) carry story AC; Scenario issues (`wave › deliver`) carry the code,
one per roadmap step via `/nw-execute`. Single feature branch (the proposal's). The migrated
seed sits under Finalize as the `nw-finalize` closeout handle.

## References
- Originating proposal: {{DC-NN}}  · docs/feature/{{feature-slug}}/
```

---

## Native-template PURGE checklist (manual — no MCP path)

The MCP cannot read or edit Linear templates. Do this once in the UI to remove old-model
assumptions (verified present as of this rewrite):

- [ ] **Story template** — re-save from the new **Story issue** shape above. Remove every trace
  of *"Skeleton task + implementation sub-issues"* and *"ONE story PR into the Release branch."*
  A Story is now a **validation surface** (no wave label, not delegated).
- [ ] **Proposal template** — re-save from the new **Proposal issue** shape. Remove *"run
  `nw-discuss` (read-only) … as analysis in this thread — do NOT create issues or edit code."*
  The proposal now runs the **full write-capable wave chain** committing artifacts.
- [ ] **Add a Release Slice issue template** and a **Scenario issue template** (new shapes above).
- [ ] **Proposals project description** — update the read-only/discuss-only prose to the full
  wave chain.
- [ ] **Retire the old task/skeleton assumptions everywhere** — no template or project prose
  should mention Skeleton tasks, implementation sub-issues, or story-PR-into-Release.

**The label taxonomy does NOT change** — `wave`/`area` and their grouped children are reused
as-is. The only rewrite-driven config change is not a label at all:

- [ ] **`labelPrompts` tool-scope remap (cyrus config, `~/.cyrus/config.json`).** The
  pre-promotion wave children (`discuss`/`design`/`distill`) now **commit artifacts**, so they
  must map to **write-capable** presets instead of the old `readOnly`. Same labels, different
  mode. `deliver` stays write-capable; add `finalize` if absent (`linear-structure.md`).

*(Unrelated pre-existing hygiene, not part of this rewrite: the flat colon-form `wave:*`/`area:*`
labels still shadow the grouped children — DC-190/DC-192 carry `wave:discuss`. Delete them and
re-tag to the child whenever convenient; it predates this change.)*
