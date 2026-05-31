# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-1

Slice: MR-1 design-token foundation + dark-mode plumbing (walking skeleton).
Commit: `c99c293` — `feat(frontend): add design-token layer + dark-mode plumbing (MR-1)` (Step-ID: 01-01).

## Outcome
- **Step 01-01: COMMIT/PASS.** All 5 DES TDD phases recorded (PREPARE/RED_ACCEPTANCE/RED_UNIT/GREEN/COMMIT); `verify_deliver_integrity` → "All 1 steps have complete DES traces" (exit 0).
- **Acceptance gate GREEN:** 9/9 vitest cases (`cd frontend && npx vitest run app/theme`); full frontend suite 648/648; eslint clean; zero `__SCAFFOLD__` markers in `frontend/app/theme`.
- **Design compliance:** all 10 changed files within roadmap `files_to_modify` (+ `theme.test.tsx`, the DISTILL-authored suite landed green). No unauthorized new components.
- **Adversarial review (Phase 4): APPROVE** (nw-software-crafter-reviewer). Zero Testing-Theater patterns, clean L1–L4. 3 non-blocking nits deferred to MR-8 (AC1b containment assertions for the token constants; SSR initial-state comment in `useTheme`; Tailwind-mapping note in `tokens.css`).

## Adaptations from the standard nw-deliver flow (per-MR frontend slice)
- **DWD-D1 — Acceptance gate is vitest, not the Python suite.** This feature's pytest acceptance suite (`tests/acceptance/pipeline-ui-design-tokens/`) is intentionally skipped behind the SSR asset-hash blocker (DISTILL UI-1 / DWD-2). The real MR-1 gate is the vitest suite. Phase 3.5's `pytest tests/acceptance/{feature}` was substituted accordingly.
- **DWD-D2 — Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories exist for this feature (DISTILL UI-2); there is no `After: run … → sees …` line to execute. Gate skipped (not applicable), not bypassed.
- **DWD-D3 — Phase 3 refactor pass skipped.** Reviewer confirmed the diff is clean at L1–L4 with no smells; a dedicated RPP pass on a ~120-line module + small wiring adds no value.
- **DWD-D4 — Phase 5 mutation testing skipped.** Standard rigor defaults to per-feature mutation, but the slice is CSS tokens + a small TS preference module whose behavior is fully pinned by the 9 example tests; mutation on this surface is low-value. Logged skip.
- **DWD-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed* feature to `docs/evolution/`. MR-1 is 1 of 8; finalize runs after MR-8. MR-1 lands incrementally via `gt mq submit` (CLAUDE.md trunk-based workflow), not a per-MR evolution archive.
- **DWD-D6 — Retrospective skipped:** clean execution (no failures, no retries).

## Carry-forward
- MR-2 (lineage Pipeline view) depends on this token layer existing — now in place.
- MR-8 polish: un-skip the SSR-ingress suite once UI-1 clears; apply the 3 review nits; verify token color values visually/Playwright (DWD-3).
