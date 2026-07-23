# Verification — AC checkoff and the two-tier trust model

nwave persists AC-per-story and the scenario→step link, but **drops** the story↔scenario link
and never carries slice identity into delivery. This workflow rebuilds those links itself —
and the rule that keeps that safe is a **two-tier trust model**.

## Two tiers: what gates, what merely signals

| Tier | Artifact | Role |
|---|---|---|
| **Objective (the gate)** | each scenario's roadmap-step `.feature` test | passes + merges → the scenario is really done. **This is what authorizes release.** |
| **Judgment (a surface)** | Story AC + Slice AC checkboxes | human/agent-readable readiness signals — **never** the machine gate |

**A slice releases when all its scenario tests are green and merged** (objective), with the
slice AC verified (below). The AC checkboxes make readiness *readable*; they do **not** by
themselves authorize the Release PR. Never let a gut-checked AC box become the release
trigger — that is the one way this model goes wrong.

## Story-AC attribution is an agent runtime judgment

There is **no** `@US-NN` Gherkin tag and **no** persisted story→scenario map (nwave discards
the PO reviewer's mapping). So attribution is a **gut decision** made when a scenario merges:

- Given the completed work, decide which **Story AC** it satisfies.
- Attribute the scenario to the **closest-matching** story/AC — even if it only *partially*
  satisfies an AC, map it to the nearest match rather than inventing a link.
- On the scenario issue: add a **`related to`** relation to those stories; check the satisfied
  **Story AC boxes** on the story issue.

Because this is judgment, a story's AC can read "checked" while only partially met — which is
exactly why the checkboxes are a surface, not a gate (above).

## Slice-AC verification (independent, dependency-gated)

Slice briefs (`slices/slice-NN-*.md`) carry their **own** AC — cross-cutting invariants (e.g.
"preview SQL unchanged post-backfill") that no single story owns. So slice AC is **not** the
sum of its stories' AC.

- **Trigger (dependency order):** run the slice check only once **all the slice's stories are
  complete**. This is a gate on *when* to check, not a derivation of the result.
- **Independent check:** verify the slice's own AC against the merged work directly. A slice
  AC can **fail even if every story passed** — surface it, leave the box unchecked, do not
  release the slice.
- Record the outcome on the **Release Slice issue** (the checklist surface — `milestone.md`).

## Where each AC lives (source of truth)

| AC | Source artifact | Linear home |
|---|---|---|
| **Story AC** | `user-stories.md` | Story issue checklist |
| **Slice AC** | `slices/slice-NN-*.md` | Release Slice issue checklist |
| **Scenario spec** | the `.feature` suite (DISTILL) | the objective gate — not a checkbox |

## Release + finalize gates

- **Slice releases** when: its scenario tests are green + merged (objective) **and** its slice
  AC verify (`intake-and-promotion.md`). Then the main session opens one Release PR
  `feature → main` (merge commit — `branching-and-merge.md`).
- **Finalize** when: all Release PRs are merged to `main` → the migrated seed issue drives
  `nw-finalize`.
