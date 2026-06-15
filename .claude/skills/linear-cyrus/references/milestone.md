# Milestone level — "Release"

A Linear **project milestone** = a **Release** (a shippable/demonstrable increment of a
feature). Milestones live **only in Feature projects**, never in Proposals.

## No wave, no delegation

A milestone has **no agent action** — you can't delegate a milestone in Linear (only
issues are delegatable). It is purely a **grouping + progress container**. It's created
by the main-session assistant during promotion (`save_milestone`), derived from the
DISCUSS release-slicing.

## Relationships

- **Project → Milestone:** a Feature project has **many** Releases (`Release 1`,
  `Release 2`, …).
- **Milestone → Story:** a Release groups **one or more stories** (1:many). The same
  release can hold several stories; a story belongs to exactly one release.
- **Release 1 is the walking skeleton** — the thinnest end-to-end path that proves the
  feature hangs together. Later releases flesh it out. Order is sequential.

## Progress is tracked at the STORY level

Assign **stories** to the Release milestone (the main session does this at promotion).
**Tasks are sub-issues of stories and are NOT put on the milestone** — partly by choice
(cleaner bar) and partly by necessity (cyrus's `create_issue` can't set a milestone).
A task closing rolls up to its story's progress bar; a story closing advances the
Release. So: milestone progress = its stories closing.

## Escape hatch — promote a Release to its own project

If a Release outgrows a slice (turns out to need many stories + its own sub-releases),
**convert the milestone to a project** (Linear ⋯ menu, or the main session recreates it
via `save_project` + moves its stories). It becomes a feature in its own right and gets
its own `feature/<slug>` branch. This is the deliberate "this grew into its own feature"
move — start lean, promote only when reality demands it.
