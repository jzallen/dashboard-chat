"""Shared Derived-Relation kernel + renderer (ADR-052).

This package is the home for the cross-role kernel the domain pass settled
(Option B: View and Report as two aggregates sharing a typed value-object
kernel). It is created empty at DISTILL as a Mandate-7 RED-scaffold anchor;
DELIVER fills it phase by phase per
``docs/feature/normalize-view-report-operations/distill/roadmap.json``:

- Phase 00: ``render_characterization`` — the render-equivalence golden-snapshot
  harness (walking skeleton).
- Phase 02: ``kernel_visitor`` + ``render_catalog`` — the consolidated renderer.
- Phases 03-07: the shared component-table read path the kernel visitor consumes.
"""
