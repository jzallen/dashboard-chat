# Story level — a validation surface

A **story** = an nwave user story (`user-stories.md`). In Linear it's an **issue** in a Feature
project, assigned to the **Release Slice** milestone that `story-map.md` grouped it with, with
its **AC checklist** (from `user-stories.md`) in the description.

A story is a **validation surface, not a build unit.** It generates no code and is **never
delegated** to cyrus. Code is produced only by **scenario** issues (`scenario.md`); a story's
AC boxes get checked as scenarios merge and the delivering agent judges which AC they satisfied
(`verification.md`). Linear auto-generates a branch for the story — **never used**.

## Where stories come from (main session, at promotion)

Stories are minted by the **main session at promotion**, read from the committed
`user-stories.md`, and placed on a slice per `story-map.md`:

1. `save_issue` — `team` = DC, `project` = the Feature project, **`area` child label only**
   (no `wave` label — a story must not be delegatable into a build), human-readable title,
   body per `issue-authoring.md` with the **AC checklist** and a `## References` pointer to
   `docs/feature/{slug}/`.
2. `save_issue(id, milestone: "Release Slice N")` — assign it to the slice `story-map.md`
   grouped it with. Milestone is project-scoped, so this is always an explicit step.

**Promotion gate:** every story maps to **exactly one** slice, and `slices/` ↔ `story-map.md`
agree on membership (`intake-and-promotion.md`). A story that spans two slices is rejected/
re-sliced — a Linear issue holds one milestone.

## AC checklist = the story's contract

The AC come from `user-stories.md` (AC-per-story). They are the story's **validation surface**:

- As scenarios merge, the delivering session judges which Story AC the work satisfies and
  **checks those boxes** (`verification.md`) — attribution is a runtime gut call, no tag.
- A story is "done" when its AC read satisfied — but that is a *surface*, not a gate. The
  release gate is the **green scenario suite** (`verification.md`).

## Every story body has an `## AGENT NOTES` section

Even though a story is not delegated for code, its body is read by any session that touches it
(and by humans). Keep the human-readable summary + AC on top; put a short `## AGENT NOTES` that
states its role, e.g.:

```
## AGENT NOTES
Validation surface — do NOT implement from this issue. Code is delivered by the linked
Scenario issues (one per roadmap step, `/nw-execute`). As scenarios merge, their sessions
check the AC below that they satisfy. This story's AC come from user-stories.md; the slice's
AC live on the Release Slice issue.
```

Keep the **title human-readable** (no wave/artifact tags), pointers under `## References`
(`issue-authoring.md`).

## Iron Rule

The AC checklist is the spec. No session may weaken or delete an AC box to make a story look
done. Unmet AC → the box stays unchecked and the slice can't release. The objective backstop is
always the scenario suite, not the checkbox.
