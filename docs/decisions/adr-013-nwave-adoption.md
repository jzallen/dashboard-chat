# ADR-013: Adopt nwave-ai as the SDLC framework

**Status:** Accepted
**Date:** 2026-04-24
**Supersedes:** OpenSpec workflow (frozen; see ADR context below)

## Context

Dashboard Chat has used OpenSpec for spec-driven change management and Gas City (`gc`) for multi-agent execution. The two have complementary but non-overlapping strengths, and the project lacks an opinionated SDLC methodology connecting discovery → design → test → delivery.

nwave-ai (v3.11.0) is an opinionated agentic SDLC framework that ships 40 Claude Code sub-agents and 147 skills, already installed at `~/.claude/agents/nw/` and `~/.claude/skills/`. It decomposes feature delivery into 8 canonical **waves** (DISCOVER → DIVERGE → DISCUSS → [SPIKE] → DESIGN → DEVOPS → DISTILL → DELIVER → FINALIZE), enforces Outside-In TDD with hexagonal testing, and pairs every producer agent with a Haiku reviewer for cost-efficient critique.

## Decision

Adopt nwave-ai as the canonical development methodology, wrapped inside Gas City for durable dispatch, worktree isolation, and pool-based parallelism.

### Six supporting decisions

1. **OpenSpec is frozen, not deleted.** Existing `openspec/changes/` and `openspec/specs/` remain on disk as read-only historical context. New work does not go through OpenSpec. A `FROZEN.md` marker in `openspec/` points here. The OpenSpec plugin skills stay installed but should not be used for new changes.

2. **Feature IDs are bead IDs.** Each nwave feature writes to `docs/feature/{bead-id}/` (e.g. `docs/feature/dc-abc123/`). Bead IDs are stable, unique, appear in git trailers, and are already tracked by `gc bd`. On feature completion, `/nw-finalize` migrates artifacts to `docs/evolution/YYYY-MM-DD-{bead-id}.md`.

3. **Default rigor profile is `standard`.** Sonnet primary + Haiku reviewer + 5-phase TDD cycle, no mutation gate by default. Persisted via `/nw-rigor standard` to `~/.nwave/global-config.json`. Mutation gate is promoted to default after the narrow-pass shakeout is stable.

4. **Build in two passes: narrow first, then full.** Narrow pass wraps only `nw-software-crafter` (DELIVER pool), `nw-acceptance-designer` (DISTILL singleton), and `nw-troubleshooter` (bug triage singleton), plus formulas `mol-nwave-distill`, `mol-nwave-deliver`, `mol-nwave-bugfix`. Full pass adds the remaining 6 wave agents, a `mol-nwave-feature` convoy compiler, and scheduled orders for hygiene.

5. **DELIVER is a pool (max=3); upstream waves are singletons.** Parallel feature delivery is the only clearly-beneficial concurrency case in this workspace. Discovery, design, and acceptance-modeling are naturally serialized per-feature.

6. **Husky pre-push gate is removed; pre-commit stays.** The `bazel test //...` pre-push was the expensive gate and is moved to CI-only. The fast pre-commit (ruff/eslint auto-fix + re-stage) stays because it complements nwave's DES gates without duplicating them. Original husky config remains recoverable via git history.

## Consequences

**Positive:**
- Single opinionated methodology instead of tool-soup (OpenSpec + ad-hoc TDD + ad-hoc design).
- Outside-In TDD enforced at agent level, not discipline level.
- Reviewer pairs give structured critique at ~Haiku cost per wave.
- Gas City supervision wraps nwave's sub-agent model with durable dispatch, worktree isolation, and mail-based handoffs.
- Parallel feature delivery via DELIVER pool.

**Negative / Accepted trade-offs:**
- OpenSpec institutional knowledge (14 changes, 96 specs) becomes frozen archive. Future refactors may want to port key specs into nwave architecture docs.
- nwave's `docs/feature/` layout is a new convention to learn.
- Reviewer pairs add a Haiku call per wave. At `standard` rigor, cost impact is modest.
- Bazel test coverage now depends entirely on CI, not pre-push enforcement. Contributors may push failing branches; CI catches them.
- nwave updates (via `/nw-update`) may change agent prompts underneath our wrappers. Wrappers delegate via `Task(subagent_type=...)` so they remain version-tolerant.

## Alternatives considered

- **Keep OpenSpec; add nwave as a layer on top.** Rejected: two overlapping SSOT hierarchies (`openspec/changes/` vs `docs/feature/`) create contradiction risk and force a rule about which wins. Cleaner to freeze one.
- **Hard-delete OpenSpec.** Rejected: active branches may still reference spec files; historical context has value; freeze is reversible.
- **Full 8-wave pack in one pass.** Rejected: debug surface triples vs narrow pass; pattern is unproven on this repo's conventions.
- **Keep husky pre-push for local fast-feedback.** Rejected: `bazel test //...` is slow enough (even cached) that contributors skip it with `--no-verify` anyway. CI is the authoritative gate.

## Implementation phases

See tasks tracked via `gc bd` or the session task list. Seven phases:

1. Audit + ADR (this document) + openspec freeze marker.
2. nwave pack skeleton (`.gc/system/packs/nwave/pack.toml`).
3. Three agent wrappers (crafter pool, acceptance-designer, troubleshooter).
4. Three formulas (distill, deliver, bugfix).
5. Hook/SSOT demolition (remove husky pre-push, update CLAUDE.md).
6. Validation (`gc config`, `gc doctor`).
7. **Full pass** (deferred to post-shakeout): remaining 6 wave agents, convoy compiler, scheduled orders, mutation-kill gate promotion.

## Amendment (2026-04-24): Brownfield entry points

Research into nwave's brownfield approach (see [docs/research/nwave-brownfield-approach.md](../research/nwave-brownfield-approach.md)) surfaces an additional convention: Dashboard Chat is a brownfield codebase, so feature work should not start at DISCOVER or DIVERGE — those waves exist to validate opportunity and generate divergent directions when the architecture is open. Here, ADRs 001–012 already ratify the architecture, so:

- **New features**: enter at **DISCUSS** (stories + AC).
- **Refactoring**: enter at **DESIGN** (or **DELIVER** if the target already has green tests).
- **Bug fix with known cause**: enter at **DISTILL** (write the regression test first).
- **Bug fix with unknown cause**: enter at **DISCOVER** (RCA, not opportunity-discovery).
- **Infrastructure**: enter at **DEVOPS**.

The invariant `DISTILL → DELIVER` still terminates every path; no exception.

Additionally: before touching untested legacy code, write **characterization tests** (Feathers) first. They are the brownfield analog to the greenfield walking skeleton. Pre-existing "testing theater" tests (tautological, implementation-mirroring, assertion-free) are triaged via the `nw-test-refactoring-catalog` L1–L3 taxonomy before deletion or rewriting — the Iron Rule applies to legitimate tests only, not theater.

## Amendment (2026-04-28): Feature dir slug naming convention

Supersedes Decision #2 ("Feature IDs are bead IDs") on the directory-naming dimension only.

Feature artifacts now live in `docs/feature/{slug}/` where `{slug}` is a kebab-case description of the feature (e.g. `log-image-identity-on-startup`). Bead IDs remain the durable feature identifier — they continue to appear in git trailers, bead descriptions, and inter-bead links — but they no longer name directories. The bead-ID directory pattern was opaque at a glance and forced a `bd show` round-trip to learn what each dir was about.

Migration: existing `docs/feature/dc-{id}/` dirs were renamed to slugs in commit `c7f531e` (bead `dc-wrg`). New features pick a slug at DISCUSS time. Archives in `docs/evolution/` are not retroactively renamed; the historical `YYYY-MM-DD-{bead-id}.md` archive shape stays as-is.

Rationale: scanability beats stable-identifier-as-path when the stable identifier already lives elsewhere (trailers, bead DB).

## References

- nwave-ai: https://github.com/nWave-ai/nWave
- Local install: `~/.claude/agents/nw/` (30 agents), `~/.claude/skills/` (147 skills)
- Gas City docs: `.gc/system/packs/` (core, bd, gastown, maintenance, dolt)
- This workspace's prior ADRs: `docs/decisions/adr-001...adr-012`
