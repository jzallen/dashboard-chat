# Intake & promotion

How a raw idea becomes a structured feature, and who does which part. Two standing backlog
projects hold ideas — **Proposals** (new features) and **Tech Debt** (debt intake) — and both
promote the same way: the seed issue **migrates into the promoted project** rather than being
left behind.

## The funnel

```
Proposals project
  └ Proposal issue — wave flag cycles: discuss → design → distill → deliver
        │   each wave = a write-capable dc-cyrus session on the proposal's branch:
        │     discuss  → docs/feature/{slug}/discuss/  (user-stories.md, story-map.md, slices/)
        │     design   → docs/feature/{slug}/design/   (ADRs, C4, domain model)
        │     distill  → tests/.../{slug}/acceptance/*.feature  (the acceptance suite)
        │     deliver  → docs/feature/{slug}/deliver/roadmap.json  (PARTIAL — stops here, no code)
        │   [main session] PROMOTE — reads the committed artifacts, mints Linear structure
        ▼
  New Feature project (named for the natural code feature name)
    + Release-Slice milestones (from slices/) + one Release Slice issue each (slice AC)
    + Story issues (from user-stories.md, grouped onto slices by story-map.md)
    + Scenario issues (from roadmap.json steps; no milestone; blocked_by per phase/step deps)
    + Finalize milestone  ← the migrated seed issue lands here (closeout handle)
        │   deliver scenarios: /nw-execute per step → scenario branch → squash into feature branch
        │   on merge: agent judges + checks the Story AC it satisfied (verification.md)
        ▼
     slice green + merged & slice AC verified → Release PR feature→main (merge, never squash)
        │   ALL Release PRs merged → relabel seed wave › finalize → delegate → nw-finalize
        ▼
     project closed out (artifacts archived to docs/evolution/); seed issue Done
```

## Division of labor (set by tool capability)

| Actor | Linear MCP | Owns |
|---|---|---|
| **dc-cyrus** | issue-scoped | the **waves** in-session, **write-capable**: the pre-promotion chain (`nw-discuss`→`nw-design`→`nw-distill`→partial `nw-deliver`, committing artifacts to the proposal's branch), then one `/nw-execute` **per scenario** after promotion |
| **main-session assistant** | full (`save_project`/`save_milestone`/`save_issue`) | the **structure**: project, Release-Slice milestones + Slice issues, Story issues, Scenario issues, dependency wiring, promotion, migrating the seed |

**cyrus runs the waves; the main session structures Linear.** cyrus cannot create projects or
milestones — those never block on it. Note the shift from the old model: **cyrus no longer
creates issues during the build** (scenarios come from `roadmap.json` and are minted by the
main session at promotion).

## The pre-promotion wave chain (write-capable)

Unlike the old read-only `nw-discuss`, the proposal now runs **four write-capable waves**,
each committing to the **proposal's branch** (which becomes the feature branch —
`branching-and-merge.md`). Cycle the proposal's `wave` flag and delegate at each:

1. `wave › discuss` → `nw-discuss` — journeys, `user-stories.md` (AC-per-story), `story-map.md`,
   and carpaccio **`slices/slice-NN-*.md`** (each with its own AC).
2. `wave › design` → `nw-design` — ADRs / C4 / domain model.
3. `wave › distill` → `nw-distill` — the **`.feature` acceptance suite** (feature-scoped;
   traces story→scenario at its review gate but does not persist it).
4. `wave › deliver` → **partial** `nw-deliver` — generate **`roadmap.json` only** (phases →
   steps), then **stop before code**. Promotion happens only after this exists.

Review between waves is your gate; relabel forward when satisfied.

## Promotion mechanics (main session)

There's no "convert issue → project" API call, so the main session **replicates** it, reading
the committed artifacts. Apply labels by the **validated grouped child name**
(`linear-structure.md`); synthesize prose, don't quote the analysis (`issue-authoring.md`).

1. `save_project` — the Feature project, named for the **natural feature name from the code**,
   team = DC. Description synthesizes the outcome + `## AGENT NOTES` + `## References`.
2. `save_milestone` (×N) — one **Release-Slice** milestone per `slices/slice-NN-*.md`
   (`Release Slice 1` = the thinnest increment). Name from the slice goal.
3. `save_issue` (×N) — one **Release Slice issue** per slice, its **slice AC** as a checklist
   (from the brief), `area` child, **no `wave` label** (not delegated — `milestone.md`).
4. `save_issue` (per story) — **Story issues** from `user-stories.md`: `area` child only, AC
   checklist, then `save_issue(id, milestone:)` onto the slice `story-map.md` grouped it with
   (`story.md`).
5. `save_issue` (per roadmap step) — **Scenario issues** from `roadmap.json`: `deliver` +
   `area`, **no milestone**, body naming `/nw-execute <slug> <step-id>` + the feature branch
   (`scenario.md`). Wire **`blocked_by`** from `phase.depends_on` / `step.deps`.
6. `save_milestone` (×1) — the **Finalize** milestone, ordered last; **migrate the seed**
   (`save_issue(id: <proposal>, project, milestone: "Finalize")`).

**No git branch creation at promotion** — the feature branch already exists (it is the
proposal's branch, carrying the committed artifacts).

### Promotion gates (block if any fail)

- **Every story ∈ exactly one slice** (Linear one-milestone constraint — `story.md`).
- **`slices/` ↔ `story-map.md` agree**: every slice has a brief and vice-versa; shared
  `slice-NN` join key.
- **`story-map.md` references final `US-NN` IDs** (cheap check; DISCUSS ran fully, so the
  Phase-4 story IDs are stamped — `docs/research/nwave-linear-mapping-rules.md` Rule 16).

nwave artifacts (JTBD, journeys, ADRs, roadmaps, slice briefs) **stay in the codebase** — never
attach them to Linear. Name them in `## References`.

## Closeout (the terminal transition)

When **all Release PRs are merged to `main`**, delegate the seed under Finalize: relabel it
`wave › finalize` (manual — it does not auto-fire) and delegate dc-cyrus. `nw-finalize` archives
to `docs/evolution/`; the seed goes **Done**.

## Tech Debt intake & promotion (unchanged)

The **Tech Debt** project is the standing debt intake (mirrors Proposals). Refactor work is
**behaviour-preserving** and does **not** use the story/slice/scenario frame — it keeps its own
path:

- **Light (single item).** Detach from Tech Debt, relabel `refactor` + area child, delegate
  dc-cyrus → `nw-refactor <path> --level=N --scope=…` (`choosing-waves.md`). No project. A
  **generator** debt issue spawns siblings as **parentless standalone** Refactor issues.
- **Heavy (own project).** Promote like a proposal into a **Refactor project** holding
  **Refactor issues** (each carrying level + scope) — not Stories/Scenarios. Slice with Release
  milestones only if the RPP cascade or Mikado phases warrant it.

## When to skip the funnel

For a small, obvious change, skip the Proposals path — create/reuse a Feature project, add the
story + its scenarios, deliver. The funnel earns its keep for genuinely new, multi-slice
features that need discussion first.
