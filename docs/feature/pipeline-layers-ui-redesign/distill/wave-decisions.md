# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-1

Slice: **MR-1 — design-token foundation + dark-mode plumbing** (walking skeleton).
Scope/decision source: `../path-forward.md` §5 (MR-1) + §9 (DECISION LOCKED — single Neobrutalist aesthetic).

---

## DWD-1 — Walking Skeleton Strategy: C (real local I/O)
**Decision:** Strategy C. The only ports this slice touches are the browser's
`localStorage` and the document root — both local, no backend/DB/external/costly
deps. WS scenarios use **real** localStorage + real `documentElement` under
happy-dom (no doubles). WS test tagged conceptually `@walking_skeleton @real-io`.
**Confirmed with user:** 2026-05-31 ("Strategy C, vitest-gated WS — go ahead").

## DWD-2 — Test medium: vitest-gated WS; SSR-ingress check deferred
**Decision:** The walking skeleton is gated by a **vitest** test
(`frontend/app/theme/theme.test.tsx`, AC1) that exercises the pre-hydration init
mechanism directly. The **true port-to-port** check — fetching server-rendered
HTML through the reverse-proxy ingress (frontend-coexistence style) — is authored
as a **deferred** `@adapter_integration @requires_external @skip` suite
(`tests/acceptance/pipeline-ui-design-tokens/`).
**Why:** the SSR container stack is currently blocked (DWD-2 ↔ upstream UI-1), so
an HTTP-ingress WS could not go green; gating in vitest keeps the slice shippable.
The repo has **no Playwright/e2e harness**, and the established frontend test
surfaces are vitest (component/integration) + pytest-over-HTTP (SSR). We did not
introduce Playwright. **Confirmed with user:** 2026-05-31.

## DWD-3 — happy-dom limitation: assert the theme CLASS, not computed colors
**Decision:** happy-dom does **not** apply external stylesheets, so the tests
assert the **theme class** on the root (the no-flash contract and the gate that
selects token values) rather than computed CSS custom-property values. Token
color *values* (Neobrutalist light / Solarized dark) are out of scope for the
unit/acceptance layer and verified visually / by a future Playwright pass (MR-8).
**What the double cannot model:** real CSS cascade, computed colors, paint, and
genuine first-paint timing — all deferred to DWD-2's ingress suite + visual QA.

## DWD-4 — Scope guard: no multi-aesthetic switcher
**Decision:** Per path-forward §9 (Option A), MR-1 builds the token layer for the
**single Neobrutalist aesthetic + a `.dark` (Solarized) class only**. No
`.theme-*` switcher, no Tweaks aesthetic selector. The only user-facing appearance
control is the dark-mode toggle (org-view), modeled here as `ThemeToggle`.

## DWD-5 — Mandate 7 scaffolding (TypeScript)
**Decision:** RED-ready scaffolds live at `frontend/app/theme/{theme.ts,
ThemeToggle.tsx,tokens.css}`, each marked `__SCAFFOLD__`/`__SCAFFOLD__:`. TS/TSX
function bodies `throw new Error("… RED scaffold (theme MR-1)")`; `tokens.css`
carries placeholder var values. Verified RED (not BROKEN): all 9 vitest cases
fail with the scaffold marker, zero import/reference errors. DELIVER replaces the
bodies (GREEN) and removes the markers (`grep -r __SCAFFOLD__ frontend/app/theme`
→ empty at done).

## DWD-6 — Driving-port note
The user-facing driving surface for this slice is the rendered app shell (the
`ThemeToggle` interaction) and the SSR first paint (init script). DESIGN-equivalent
SSOT is `path-forward.md` §4.3 (token layer in `root.tsx`/`Layout`, `.dark` class,
localStorage). No `docs/product/architecture/brief.md` "For Acceptance Designer"
section existed; ports derived from path-forward + repo precedent (`root.test.tsx`,
`frontend-coexistence`).
