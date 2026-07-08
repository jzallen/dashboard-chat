# Issue authoring — titles, descriptions, linking

How every Linear issue we create (proposal, story, task) should read. **The description
is the agent's prompt** *and* a human's briefing, so it has to serve both without one
leaking into the other. Applies to the main session materializing stories at promotion
and to dc-cyrus creating task sub-issues during distill.

## Titles are human-readable, self-contained

A title says **what the work is**, in plain language, for a human scanning the backlog.

- **No nwave/process vocabulary in the title.** No wave names, RPP levels, tier labels,
  "walking skeleton," artifact filenames, or command strings. Those are *how* we'll do
  it, not *what* it is — they live in labels and the AGENT NOTES section.
- **No inter-issue relationship in the title.** No "(DC-160 Tier 2 #4)", "part of…",
  "follow-up to…", parent/epic tags, or ordinal suffixes. Relationships are modeled
  structurally (see Linking below), never spelled into the name.
- Prefer the outcome: `Clarify the JSON:API unwrap boundary`, not
  `Clarify the JSON:API unwrap boundary (DC-160 Tier 2 #4)`.

## Description anatomy

Top-to-bottom, human-readable first, machine notes fenced off, pointers last:

```
<1–3 sentence plain-language summary of the change and why it matters>

<optional: AC checklist / Given-When-Then, or the body of the brief>

## AGENT NOTES
<instructions aimed at the cyrus agent: which skill/wave to run, guardrails,
 delivery mechanics. Keep human prose above this line free of it.>

## References
<pointers to codebase docs/ADRs/other issues — see below. Bottom of the description.>
```

- **Human-readable body on top.** Someone who doesn't know nwave should understand the
  issue from the summary alone.
- **`## AGENT NOTES`** holds everything addressed to the agent — the required
  wave-instruction (name the skill + `/nw-*` command + guardrails; see `story.md`),
  plus any "do X not Y" for the session. This is the one place process/nwave vocabulary
  belongs. It replaces the older inline `AGENT INSTRUCTION:` line — same job, named
  section.
- **`## References`** (bottom) is the *only* place for pointers to other documentation:
  ADRs, `docs/**` research files, design docs, related-issue IDs. Never fold a doc
  reference into the summary or the title.

## Linking to other issues

Never encode a relationship in the title or prose narration. Instead:

1. **Structural link (preferred): "Mark as related to".** Use Linear's relation
   (`related` / `blocks` / `blocked by`) so the graph is queryable and shows on both
   issues. Task sub-issues already use `blocked by` the skeleton — same mechanism.
2. **Mention the Linear id in the description.** When a soft pointer is enough, name the
   issue by id (e.g. "context in DC-160") in the body — ideally under `## References` —
   so it auto-links, without asserting a typed relation.

Pick the relation when the dependency is real (it affects ordering/readiness); pick the
id-mention when you just want a breadcrumb.

## Why

Titles and human prose polluted with tier tags, artifact names, and "#4 of" ordinals
read as machine exhaust and rot the backlog's scannability — and they duplicate, badly,
what labels and Linear relations already model. Keep *what it is* human, push *how we do
it* into AGENT NOTES, and push *what it points at* into References.
