# nwave → Linear Mapping Rules (DRAFT for review)

> Status: draft under review. Encodes how the linear-cyrus workflow maps nwave
> wave artifacts onto Linear objects. Validated against canonical nwave-ai
> (skills / task files / DES schema), not against past `docs/` usage.
>
> Key canonical facts this design is built around (see the
> `nwave-canonical-wave-artifact-flow` memory): release slices are a DISCUSS
> artifact and terminate there; `roadmap.json` is DELIVER-only and organized by
> phases→steps with **no** slice field; the story↔scenario link is enforced at a
> DISTILL review gate but **never persisted**. The three links nwave drops
> (story↔scenario, slice-AC verification, story↔slice at promotion) are supplied
> by this workflow.

## A. Wave execution (proposal stage)

1. A **Proposal** (linear-cyrus concept, not nwave) runs **DISCUSS → DESIGN → DISTILL**, then a **partial DELIVER** that stops after generating `deliver/roadmap.json` (docs artifacts only, no code).
2. No wave except DELIVER is ever run in part. All DISCUSS phases (including Phase 4 Requirements, where `US-NN` IDs are stamped) complete before DISTILL; promotion happens only after the DELIVER roadmap is generated.

## B. Entity mapping

3. **Feature** → Linear **Project**.
4. **Release Slice** → Linear **Milestone** *and* a **Release Slice issue** (the issue is the checklist surface for the milestone).
5. **User Story** → Linear **Issue**, assigned to the Milestone of its slice.
6. **Scenario** (≡ a DELIVER roadmap **step**; 1 scenario = 1 step = 1 `.feature` scenario) → Linear **Issue with no Milestone**.
7. DELIVER **phases** are **not** issues — they exist only to supply dependency ordering (Rule 18).
8. Terminology discipline: "phases" and "steps" are **DELIVER** artifacts, never DISTILL. DISTILL produces only `.feature` scenarios.

## C. Sources of truth

9. **Milestone identity + Release Slice AC** ← `slices/slice-NN-*.md` (the slice brief's own AC).
10. **Story → slice grouping** ← `story-map.md`.
11. **Story AC** ← `user-stories.md` (AC-per-story).
12. **Scenario/step set + dependencies** ← `deliver/roadmap.json`.
13. Naming: Milestone and Release Slice issue names derive from the **slice's goal** (`slices/` brief).

## D. Containment & promotion-gate validation

14. **Every story belongs to exactly one slice** (hard constraint: Linear allows one Milestone per issue). Reject / re-slice on violation.
15. **`slices/` ↔ `story-map.md` must agree**: every slice in the map has a brief and vice-versa; the `slice-NN` key is shared across both (the join key).
16. Promotion validates that `story-map.md`'s slice membership references final `US-NN` story IDs (i.e., the Phase-4 "revisit this table" step was performed). Cheap consistency check, not a reconciliation step — DISCUSS is fully complete by promotion time (Rule 2).
17. Promotion is blocked if 14–16 fail.

## E. Dependencies & ordering

18. **Scenario/step issues** get `blocked_by` edges from the **DELIVER phase/step dependency graph** (`phase.depends_on` / `step.deps`).
19. **Release Slice issue** is `blocked_by` its member **User Story** issues.
20. **Release Slices execute sequentially.** **Scenarios within a slice may parallelize.**

## F. Roles (code generation vs. validation)

21. **Release Slice** and **User Story** issues are **validation surfaces only** — they never generate code.
22. **Scenario/step** issues are the **only** code-generating units (driven by `/nw-execute` per step).

## G. Branching & PRs

23. The **feature branch** is the branch of the **original Proposal issue**.
24. Every **scenario branch** is based on the feature branch.
25. Scenario branches **squash-merge** into the feature branch → one atomic commit per scenario.
26. A **Release PR** goes **feature → main** and **must be a merge commit — never squash** (squash re-surfaces prior slices and breaks the chain).
27. There is **one Release PR per slice**; all Release PRs target `main` from the same feature branch.
28. The Release Slice issue's Linear-auto-generated branch is **unused** (Linear forces its creation; ignore it).
29. Invariant (consequence, not enforced): `main` becomes a **linear series of atomic scenario commits**, grouped by the slice PR that carried them.

## H. Verification (the links nwave doesn't persist — this workflow supplies them)

30. **Scenario→story-AC attribution is an agent runtime judgment, backed by no artifact.** Given merged work, the agent decides which Story AC it satisfies and attributes the scenario to the closest-matching story/AC, even on partial satisfaction. There is no `@US-NN` tag or persisted map.
31. On scenario merge to feature, the agent judges which Story AC the completed work satisfies and marks the scenario issue **related to** the closest-match story/AC.
32. When all Stories in a slice are complete, run an **independent** verification of the **slice's own AC** (gated on — not derived from — story completion) and check the slice AC boxes. Cross-cutting slice AC may fail even if all stories pass.
33. **Two-tier trust (the load-bearing rule):** objective rigor lives at the **scenario/test tier** — a scenario's roadmap-step test passes and is merged. Story AC and Slice AC checkoffs (Rules 31–32) are **human/agent validation surfaces** layered on top, not machine gates. The release gate (Rule 35) is the **green scenario suite**, never the AC checkboxes.

## I. Release & finalization

34. Story/Slice AC checkoffs make slice readiness **readable**; they do not by themselves authorize release (Rule 33).
35. **A slice releases when all its scenario tests are green and merged** (objective gate). At that point, with slice AC verified (Rule 32), open and merge the slice's Release PR (feature → main).
36. **When all Release Slice PRs are merged to main**, use the **original Proposal issue** to run **finalize** (`nw-finalize` → migrate to `docs/evolution/`) and clean up branches.

## Open items for review

- **Rule 16 residue:** may be dropped entirely if the wave-completion invariant (Rule 2) is trusted to include the story-map "revisit with final IDs" substep.
- **Rule 15 join key:** depends on canonical `story-map.md` carrying a machine-readable `slice-NN`↔`US-NN` membership. Not yet verified against the `story-map.md` schema.
- **Rule 33/35 tension to watch:** gut-based story-AC checkoff (Rule 30) must not become the release trigger; keep the green scenario suite as the gate.
