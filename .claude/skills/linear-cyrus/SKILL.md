---
name: linear-cyrus
description: >
  Use when planning, organizing, or driving work through Linear with the cyrus
  Claude Code agent — running the Proposals→feature funnel, creating projects /
  Release-Slice milestones / stories / scenarios, mapping nwave waves
  (discuss/design/distill/deliver) to Linear labels, promoting a proposal into a
  feature project, delegating sessions to @dashboard-chat, verifying AC, or
  parallelizing work. Triggers: "linear", "cyrus", "proposal", "promote",
  "release slice", "scenario", "feature branch", "delegate the issue",
  "acceptance checklist", "agent session".
---

# Linear + Cyrus workflow

How we coordinate work on this repo: **Linear is the front door, cyrus is the
hands.** Planning, review, and merge live in Linear; cyrus turns a delegated issue
into a git worktree, runs a Claude Code session, and opens a GitHub PR you review and
merge **inside Linear** ([diffs](https://linear.app/docs/diffs)). This replaced the
gastown merge queue (retired 2026-06-15; parked in `.claude/retired-skills/gastown/`).

This skill maps the **nwave wave artifacts onto Linear** per the canonical wave→artifact
flow (see the `nwave-canonical-wave-artifact-flow` memory and
`docs/research/nwave-linear-mapping-rules.md`, the ratified ruleset this skill implements).
The load-bearing facts that shape everything below: **release slices are a DISCUSS
artifact** (`slices/slice-NN-*.md`), the **roadmap is DELIVER-only** and organized as
**phases → steps** (a step = one acceptance scenario), and the **story↔scenario link is
never persisted by nwave** — this workflow rebuilds it as an agent runtime judgment.

## Who does what — the core split

**cyrus runs the waves; the main session structures Linear.** Tool-enforced:

- **dc-cyrus** has an **issue-scoped** Linear MCP → runs the **waves** in a git worktree:
  the pre-promotion chain (`nw-discuss` → `nw-design` → `nw-distill` → partial `nw-deliver`,
  all **write-capable**, committing artifacts to the proposal's branch) and, after promotion,
  one `/nw-execute` session **per scenario**. It **cannot** create projects or milestones.
- The **main-session assistant** has the **full** Linear MCP (`save_project`,
  `save_milestone`, `save_issue`) → owns **structure**: the Feature project, Release-Slice
  milestones, and the Slice / Story / Scenario issues minted **from the committed artifacts
  at promotion**.

## The levels (one file each in `references/`)

```
Proposals project ── proposal issue ── wave flag cycles: discuss → design → distill → deliver
      │   each wave = a write-capable cyrus session committing to the proposal's branch
      │   (= the future FEATURE branch); partial-deliver stops after roadmap.json — no code
      │  [main session] PROMOTE — reads the committed artifacts, mints Linear structure,
      │                            MIGRATES the seed issue into the project
      ▼
Feature project   = nwave feature   (named for the natural code feature name)
  ├ Release Slice (milestone)   ← slices/slice-NN-*.md · carries the slice AC
  │   ├ Release Slice issue     ← checklist surface for the slice AC (not delegated)
  │   └ Story (issue)           ← user-stories.md, grouped onto this slice by story-map.md
  │                               · AC checklist · validation surface (not delegated)
  └ Scenario issues (no milestone)  ← roadmap.json steps · the ONLY codegen unit
        · deliver label · one /nw-execute session each · scenario branch → squash into feature
  Finalize (milestone) → holds the migrated seed = nw-finalize closeout handle
```

Labels are the **grouped** `wave`/`area` children — apply by validated child name
(`linear-structure.md`), never the colon-form string.

- **The feature has ONE branch** = the proposal issue's branch. Scenario branches are cut
  from it; each scenario **squash-merges back into it** (one atomic commit per scenario).
  Release Slice issues own a Linear-auto branch that is **never used** (`branching-and-merge.md`).
- **Slices ship incrementally to main.** When a slice's scenarios are all green + merged and
  its AC verify, the main session opens **one Release PR** `feature → main` (**merge commit,
  never squash**). Slices are **sequential**; scenarios **within** a slice may parallelize.
- **Two-tier trust:** the objective gate is the **green scenario suite** (each scenario's
  roadmap-step test). Story/Slice **AC checkoffs are validation surfaces**, not gates
  (`verification.md`).
- **Story↔scenario attribution is an agent runtime judgment** — no tag, no artifact. On
  scenario merge the agent marks the scenario **related to** the closest-match story/AC and
  checks that story's AC boxes (`verification.md`).
- **Status automation:** branch → In Progress, PR → In Review, merge → Done.

## Canonical lifecycle

1. Add a **proposal** issue to the **Proposals** project (`wave › discuss`).
2. Delegate dc-cyrus and **cycle the wave flag** `discuss → design → distill → deliver`,
   delegating at each — each wave runs write-capable and **commits its artifacts to the
   proposal's branch** (`docs/feature/{slug}/…`, the `.feature` acceptance suite, and finally
   `roadmap.json`). Partial-deliver **stops after roadmap.json** — no production code.
3. **Promote** (main session): read the committed artifacts and mint —
   - the **Feature project** (named for the code feature);
   - **Release-Slice milestones** from `slices/` + a **Release Slice issue** per slice (slice
     AC as a checklist);
   - **Story issues** from `user-stories.md`, each on the slice `story-map.md` grouped it
     with (story AC as a checklist);
   - **Scenario issues** from `roadmap.json` steps (no milestone, `deliver` label), wired
     `blocked_by` per the roadmap phase/step deps;
   - a **Finalize** milestone; **migrate the seed issue** into it.
   (Promotion gate: every story ∈ exactly one slice; `slices/` ↔ `story-map.md` agree — see
   `intake-and-promotion.md`.)
4. **Deliver scenarios** (sequential by slice, parallel within a slice): delegate dc-cyrus per
   scenario → `/nw-execute <feature> <step-id>` on a scenario branch off the feature branch →
   **squash-merge into the feature branch**. On merge, the session marks the scenario related
   to the story/AC it satisfied and checks those story AC boxes (`verification.md`).
5. When a slice's scenario tests are all **green + merged**, verify the **slice AC** on the
   Release Slice issue (independent check, gated on its stories being complete). Then the main
   session opens **one Release PR** `feature → main` (merge commit) and merges it.
6. **All Release PRs merged** → relabel the seed `wave › finalize` (manual) → delegate →
   `nw-finalize` archives to `docs/evolution/` (see `intake-and-promotion.md`).

Parallelize **scenarios within a slice** (disjoint code surface), never across slices — a
slice's Release PR carries whatever is on the feature branch, so slices serialize at the PR
boundary (see `parallel-execution.md`).

## References

| File | Covers |
|---|---|
| `references/choosing-waves.md` | which `wave:*`/`/nw-*` to pick; **nw-deliver vs nw-refactor**; RPP levels + scope/flags; **nw-finalize (load skill from GitHub)** |
| `references/issue-authoring.md` | titles/descriptions: human-readable name, `## AGENT NOTES`, `## References`, issue linking |
| `references/intake-and-promotion.md` | Proposals→feature funnel, the pre-promotion wave chain, promotion mechanics + gates |
| `references/project.md` | Proposals vs Feature projects; the single feature branch; who creates them |
| `references/milestone.md` | Milestone = **Release Slice** (from `slices/`); the Slice issue as AC checklist surface; Finalize lifecycle milestone |
| `references/story.md` | Story = a validation surface (AC checklist), grouped onto a slice by `story-map.md`; not delegated for code |
| `references/scenario.md` | Scenario = a roadmap **step** = the codegen unit; `/nw-execute`; scenario branch → squash into feature |
| `references/verification.md` | two-tier trust (green suite is the gate); agent-judgment AC attribution; slice-AC verification |
| `references/branching-and-merge.md` | one feature branch; scenario squash-in; **Release PR feature→main (merge, never squash)**; slice sequencing; `baseBranch` caveat |
| `references/parallel-execution.md` | parallelize scenarios within a slice; slices sequential; conflict avoidance |
| `references/linear-structure.md` | **grouped-label** taxonomy (child name not colon-form), routing (`teamKeys` + `labelPrompts`), views |
| `references/templates.md` | canonical body shapes; native-template UI checklist; the old-model assumptions to purge |
| `references/triggering-sessions.md` | how a session fires: the proposal write-chain, per-scenario `/nw-execute`, daemon+pump |

## Prerequisites (ops)

The cyrus daemon (`cyrus` on :3456) and a continuous SQS-mode pump must be running on the
devpod for delegations to drive sessions. See `references/triggering-sessions.md` and the
project memory `cyrus-local-running`.
