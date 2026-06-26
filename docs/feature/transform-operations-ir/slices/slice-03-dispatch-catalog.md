# Slice 03 — One dispatch catalog + renderer-completeness probe

**Story:** US-3 · **Sub-job:** SJ-3 · **ADR-051:** D3 / decision 4 · **Effort:** ~1 day (split if >1)

## Goal (one sentence)
Collapse the triplicated `CleaningExpression` rules into a single dispatch catalog with one visitor per target, and make a renderer-completeness probe fail the build if any visitor is missing an operation — so adding an operation is one place and the arms cannot drift.

## IN scope
- Single catalog keyed by the operation discriminator; each entry co-locates the op's validate + ibis-render + display-render closures (collapse `types.py:138-267`'s three `match` spines).
- Bring `QueryBuilderJSON.as_ibis_filter` (`types.py:34-117`) under the same dispatch discipline.
- **Renderer-completeness probe**: a static (AST / catalog-membership) check asserting every discriminator has an entry in every active visitor; a gap fails the build naming the discriminator.

## OUT scope
- Sidecars (Slice 04) and the M visitor (Slice 05) — the catalog must *admit* a new visitor cheaply, but neither is added here.
- Any change to operation *semantics* — this is behavior-preserving.

## Learning hypothesis
**Disproves** that the three arms collapse to one catalog with **byte-identical** render output. If the collapsed catalog renders differently from today, the three `match` blocks had already drifted — a latent bug this slice surfaces.
**Confirms** that operation rules are genuinely one rule-set expressed thrice (the premise of the catalog).

## Acceptance criteria
- AC1: For every existing operation, ibis render and display-SQL render are byte-identical before vs after the collapse (production-data golden tests).
- AC2: The completeness probe passes for the current vocabulary.
- AC3: Deleting one catalog entry locally makes the probe **fail at build time** naming the missing discriminator (negative test).
- AC4: Adding a new (stub) discriminator with no visitor entry fails the build, not a runtime silent skip.

## Dependencies
None hard, but is the abstraction Slices 04 and 05 build on (carpaccio "ship the abstraction first"). Blocks 04; benefits 05.

## Split plan (if the collapse exceeds 1 day)
- **3a**: catalog + visitors for the `CleaningExpression` (clean/map/alias) arm.
- **3b**: bring the filter arm (`QueryBuilderJSON.as_ibis_filter`) under the catalog.
The completeness probe lands with 3a and is extended by 3b.

## Reference class
Visitor/dispatch refactor over a closed discriminator set. ADR-026 forbids rules-as-data — this stays "operations are data, rendering is code."
