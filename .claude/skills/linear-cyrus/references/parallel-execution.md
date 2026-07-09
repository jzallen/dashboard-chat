# Parallelizing across stories

Concurrency lives **at the story level**: many story deliver sessions can target the same
Release branch at once, each in its own cyrus worktree. **Tasks within a story are NOT a
parallel unit** — they share the story's skeleton (implementation tasks fill in interfaces
the Skeleton task defined), so the one builder session works them sequentially. The
independent unit is the **story**.

## When two stories are parallel-safe

Both must hold:

1. **Disjoint code surface.** They don't edit the same files/modules. Different `area`
   children are a strong proxy (`area › ui` vs `area › backend` rarely collide); two
   `area › ui` stories need a closer look at which components/files each touches.
2. **No data/contract dependency.** Neither needs the other's output — no shared new API
   contract, schema/migration, type, or fixture that one defines and the other consumes.

If both hold, deliver them concurrently (relabel each `wave › deliver` + @mention). They
produce independent **story PRs** into the Release branch; merge in completion order
(later merges rebase on the advanced Release branch; CI re-runs on each story PR).

## Encoding dependencies in Linear

- Use Linear **"blocked by" / "blocks"** relations for genuine ordering. Anything **not**
  in a blocking chain is a candidate for the parallel batch.
- A clean read: open the Release milestone, group ready stories by `area` child, drop any
  with an open "blocked by" — what remains is your concurrent batch.
- Prefer **slicing stories along subtree/area lines** so parallel sessions touch disjoint
  files by construction. A story that spans many areas is hard to parallelize and hard to
  review — split it (often into separate per-area stories).

## Distill-first de-risks parallelism

Running `wave › distill` on candidate stories **before** parallelizing reveals shared
interfaces: if two stories' skeletons/AC checklists reference the same new type, contract,
or fixture, they share a dependency — sequence them (the one defining it first) instead of
running them together.

## Collision handling

- The **Release branch is the integration point.** If two parallel stories touch
  overlapping code, the second story PR to merge hits a conflict or a red gate there —
  caught before `main`, never on trunk.
- Keep parallel WIP to the count of genuinely independent ready stories. More than that
  just manufactures merge conflicts on the Release branch.
- If a conflict appears, resolve it in the **trailing** story's session (re-mention with a
  note to rebase onto the updated Release branch) rather than the merged one.

## Rule of thumb

> Parallelize across `area:*` stories, sequence within shared contracts, never parallelize
> tasks inside one story. Let the Release branch + story-PR CI be the safety net.
