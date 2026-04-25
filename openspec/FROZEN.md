# OpenSpec — Frozen (2026-04-24)

New development work does **not** use OpenSpec. This directory remains on disk as read-only historical context.

- **Why**: See [ADR-013 — Adopt nwave-ai as the SDLC framework](../docs/decisions/adr-013-nwave-adoption.md).
- **What replaces it**: nwave-ai waves (DISCOVER → DIVERGE → DISCUSS → DESIGN → DEVOPS → DISTILL → DELIVER → FINALIZE). Features live in `docs/feature/{bead-id}/` during delivery and archive to `docs/evolution/` on completion.
- **Status of contents**: `openspec/changes/` and `openspec/specs/` reflect state as of the freeze date. Do not edit. Do not add new changes. Do not rely on these documents as current SSOT for code behavior — the code is.
- **Plugin skills**: `openspec-*` / `opsx:*` skills are still installed by the OpenSpec plugin. Do not invoke them for new work. Use `/nw-*` commands instead.
- **Reversal**: Freeze is reversible via git. This marker + ADR-013 can be removed; OpenSpec resumes.
