# Templates — canonical shapes for each primitive

Every proposal / project / story / task / debt item has a **canonical body shape** so good
issue hygiene is the path of least resistance instead of something re-derived from prose
each time. Two surfaces carry those shapes, split by **who creates the primitive**:

- **Human-authored** primitives (Proposal, Tech Debt intake, and any story/project you hand-
  author) → **Linear native team templates**. Pick the template in the UI (or use its
  unique email address) and the body, labels, and defaults pre-fill. This is the intuitive
  path and needs no in-repo file.
- **Agent-built** primitives (stories at promotion via the main session; Skeleton + impl
  tasks at distill via dc-cyrus) → the **per-level reference files** are the shape the agent
  fills via `save_issue` / `create_issue`. The MCP **cannot apply a Linear template** (no
  `templateId` argument), so for these the shape must live where an agent reads it.

The native template and the reference shape describe the **same** body — keep them in sync.

## What a Linear template can preset (and can't)

A **team** issue template presets team, status, priority, assignee, **delegated agent**,
project, labels, estimate, and sub-issues, and has a **unique email address** that applies
it on create. It **cannot** be applied through the API/MCP, and it can't target a specific
**milestone** (milestones are project-scoped and dynamic) — so milestone assignment is
always an explicit post-create step. **Do not preset the delegate on the Story template**:
delegation must come *after* project + Release are attached, or distill fires too early
(see `story.md` § Creating a story). Project templates have no email affordance and are
created by hand in Settings.

## Authoring loop (how these templates get made)

1. The main session **creates a canonical example issue** via `save_issue` (labels applied
   by grouped child ID — `linear-structure.md`).
2. A human **promotes it to a team template** in Linear (⋯ → Save as template), then
   deletes/archives the example.
3. **Project templates** (Feature, Refactor) are created by hand in Settings from the specs
   below — no MCP path exists.

## Which shape lives where

| Primitive | Creator | Shape / template |
|---|---|---|
| **Proposal issue** | human | native template — below |
| **Tech Debt intake issue** | human | native template — below |
| **Refactor issue** | human / main session | native template — below |
| **Story issue** | main session (at promotion); human for one-offs | native template + `story.md` |
| **Skeleton task** | dc-cyrus (at distill) | `skeleton-task.md` |
| **Implementation task** | dc-cyrus (at distill) | `task.md` |
| **Feature project** | main session (at promotion) | spec below + `project.md` |
| **Refactor project** | main session | spec below |

Placeholders: `{{token}}` = mechanical substitution (`{{feature-slug}}`, `{{area}}`,
`{{release-n}}`); `<free prose>` = author writes it. Labels are grouped `wave`/`area`
**children** applied by name/ID, never the colon-form.

---

## Proposal issue  (labels: `wave › discuss`, `area › {{area}}`)

```
<1–3 sentences: the problem or opportunity to explore, and why it matters now. No
solution yet — a topic to discuss, not a plan.>

## What we'd want to learn
- <open question the discussion should settle>

## AGENT NOTES
Reference the `linear-cyrus` skill. While labeled `wave › discuss`, run `nw-discuss`
(read-only) to produce the JTBD analysis, stories, and Given-When-Then AC **as analysis in
this thread** — do NOT create issues or edit code. The main session materializes stories at
promotion. Do not jump ahead to distill or deliver.

## References
- <related ADR / docs pointer / Linear id>
```

## Story issue  (labels: `wave › distill`, `area › {{area}}`; no preset delegate)

```
<1–3 sentences that synthesize what this story delivers and why — plain language, not a
quote of the discuss analysis.>

## Acceptance criteria
- [ ] **Given** <context> **when** <action> **then** <observable outcome>

## AGENT NOTES
Reference the `linear-cyrus` skill. While labeled `wave › distill`, run `nw-distill` to
DECOMPOSE this into a Skeleton task + implementation sub-issues — create issues only, do
NOT implement. When relabeled `wave › deliver`, run `nw-deliver` to implement the AC
checklist test-first and open ONE story PR into the Release branch. Do not skip distill.

## References
- <ADR / docs/feature/{{feature-slug}}/ / related Linear id>
```

## Tech Debt intake issue  (project: Tech Debt; labels: `wave › refactor`, `area › {{area}}`)

Membership in the **Tech Debt** project is the marker — no extra label axis. Use `discuss`
instead of `refactor` if the item needs scoping before it's actionable.

```
<1–3 sentences: what's structurally wrong (duplication, primitive obsession, hotspot
churn) and the cost of leaving it. Behaviour does NOT change.>

## AGENT NOTES
Reference the `linear-cyrus` skill. Behaviour-preserving cleanup — when promoted, run
`nw-refactor <path> --level=<N> --scope=<file|module|package>` (add `--mikado_planning=true`
if it crosses modules). Hard gates: a green suite over the code you touch, and
characterization tests first for any untested legacy in scope. If you find yourself writing
an AC for new behaviour, this is a Story, not debt.

## References
- <hotspot output / ADR / related Linear id>
```

See `intake-and-promotion.md` § Tech Debt for the light (detach → delegate) vs heavy
(Refactor project) promotion paths.

## Refactor issue  (labels: `wave › refactor`, `area › {{area}}`)

The actionable form of debt — distinct from a Story (no AC checklist / skeleton frame).

```
<1–3 sentences: the structural change and why it's behaviour-preserving.>

## Cleanup target
- **Scope:** `<path>` — `--scope=file | module | package`
- **Level:** `--level=<N>` (RPP L1–L6; ~80% of value is L1–L2)

## AGENT NOTES
Reference the `linear-cyrus` skill. Run `nw-refactor <path> --level=<N> --scope=<scope>`
(+ `--mikado_planning=true` if multi-module). Green suite + characterization tests are hard
gates. Do NOT add observable behaviour.

## References
- <hotspot output / ADR>
```

---

## Feature project — template spec  (create by hand in Settings)

- **Name:** the natural feature name from the code (no wave/artifact/ticket vocabulary).
- **Milestones:** the Release slices, plus a **Finalize** milestone ordered last
  (`milestone.md`).
- **Description:**

```
<1–3 sentences synthesizing the feature goal — the outcome and for whom.>

## Scope
- <what's included>  · <explicit non-goal>

## AGENT NOTES
Promoted from a proposal. Stories carry the work (labeled `wave › distill`); the migrated
seed issue sits under Finalize as the `nw-finalize` closeout handle.

## References
- Originating proposal: {{DC-NN}}  · docs/feature/{{feature-slug}}/
```

## Refactor project — template spec  (create by hand in Settings)

- **Name:** the natural name of the subsystem/cleanup.
- **Holds Refactor issues**, not Stories. Slice with Release milestones only if the RPP
  cascade or Mikado phases warrant it; add a **Finalize** milestone for the migrated seed.
- **Description:** same anatomy as the Feature project, with AGENT NOTES noting the work is
  behaviour-preserving (`nw-refactor`, level + scope per issue).

---

## One-time Settings checklist (manual — no MCP path)

- [ ] **Delete the flat `wave:*` / `area:*` labels** so only the grouped children remain
  (removes the colon-form footgun — `linear-structure.md`).
- [ ] **Create the `finalize` child** under the `wave` group and add its `labelPrompts`
  entry (write-capable mode) so `wave › finalize` routes to `nw-finalize`.
- [ ] **Promote** each example issue (Proposal, Story, Tech Debt, Refactor) to a **team
  template**.
- [ ] **Create the Feature and Refactor project templates** from the specs above.
