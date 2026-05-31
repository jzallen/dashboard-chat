# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-4

Slice: MR-4 — Assistant FAB / glass overlay (light) + docked TUI terminal (dark);
`/` index swap to the Pipeline landing.
Roadmap: `../distill/roadmap-mr4.json` (3 steps). DES record (this slice):
`deliver/mr4/{roadmap.json, execution-log.json}`.

Commits (atomic, sequential):
- `3b9397c` — `test(frontend): RED acceptance suite + scaffolds for MR-4 assistant + index swap` (DISTILL RED + scaffolds + test re-specs)
- `a590b43` — `docs(pipeline-ui-redesign): DISTILL artifacts for MR-4 (roadmap, walking-skeleton, wave-decisions)`
- `c22c4a0` — `feat(frontend): add assistant FAB + glass overlay / TUI terminal (MR-4 step 04-01)` (Step-ID 04-01)
- `ae6d4c8` — `feat(frontend): mount assistant in AppShell; trim breadcrumb menu to Query Engines (MR-4 step 04-02)` (Step-ID 04-02)
- `f170d62` — `feat(frontend): swap / index to Pipeline landing via HomeRedirect (MR-4 step 04-03)` (Step-ID 04-03)

## Outcome
- **All 3 steps COMMIT/PASS.** Each ran the DES TDD phases (PREPARE / RED_ACCEPTANCE /
  [RED_UNIT SKIPPED] / GREEN / COMMIT); `verify_deliver_integrity
  docs/feature/pipeline-layers-ui-redesign-mr4/deliver/` → "All 3 steps have complete
  DES traces" (exit 0). The committed DES record was consolidated into `deliver/mr4/`
  (DWD-M3-D6 path quirk — see below).
- **Acceptance gate GREEN:** 13 MR-4 vitest cases (8 Assistant + 3 home + 1 AppShell
  mount + 1 Breadcrumb absence). **Full frontend suite 704/704** (81 files — up from
  691 at MR-3: +9 Assistant + 3 home + 1 AppShell mount, net of the 2 removed
  breadcrumb utility cases replaced by 1 absence case). Zero `__SCAFFOLD__` markers
  remain under `frontend/src/ui/components/Assistant`, `frontend/app/routes/home.tsx`.
- **Sequential dispatch honored:** one crafter step at a time; each verified (its
  scenarios green, no testing-theater, commit scope correct, no scaffold left, no
  previously-passing test regressed) before the next, per saved-feedback. The
  DISTILL-authored RED for not-yet-reached steps stayed RED until its step (after
  04-01: 5 expected-RED → after 04-02: 3 expected-RED → after 04-03: 0).
- **Adversarial review (Phase 4): APPROVE, no defects.** `nw-software-crafter-reviewer`
  confirmed: ui-state wire untouched (no `@dashboard-chat/ui-state-wire` /
  `lib/ui-state-client` import; no new chat/stream client), zero testing-theater (real
  MessageList/ChatInput render the context messages; navigation asserted by destination
  render), complete wiring (no TBU; Assistant ← AppShell, sub-components ← Assistant),
  useIsDark SSR-safe + observer-cleaned, correct FAB-hidden / dark-branch / HomeRedirect
  branches, no react-router-dom hazard, no scope creep. No revision required.
- **DISTILL gate (prior): APPROVE** (nw-acceptance-designer-reviewer) — 0 blockers,
  ~62% branch/edge coverage.

## Design / scope adherence
- **Pure presentation reshell — ui-state wire untouched.** The Assistant consumes the
  existing `ChatProvider` (`useChatContext`) + `useSessions` hook unchanged; recents
  come from the dataCatalog sessions port; "All Chats" routes to the existing
  `/sessions`. No `@dashboard-chat/ui-state-wire` / `lib/ui-state-client` import added;
  no new chat/stream client instantiated; the agent contract + transport are untouched
  (saved-feedback constraint, DWD-M4-3).
- **Light = glass/comic overlay, dark = docked TUI terminal**, branched off the
  authoritative `.dark` root class via `useIsDark` (useSyncExternalStore +
  MutationObserver) — both render the SAME feed (DWD-M4-4). Single Neobrutalist +
  Solarized `.dark` tokens via `Assistant.module.css`; no aesthetic switcher
  (path-forward §9, DWD-M4-10).
- **Assistant mounts at shell level** as a sibling of `<Outlet/>` inside the existing
  StreamProvider+ChatProvider wrap (path-forward §4.4, DWD-M4-7); the FAB hides while
  the org sheet is open (`?org=1`) so it never overlaps the sheet.
- **Breadcrumb absorbs its interim session controls.** New Session + All Chats moved
  into the assistant overlay; the breadcrumb's MR-3 interim utility menu is reduced to
  Query Engines and drops its `useChatContext` import (DWD-M4-6). Superseded interim
  behavior re-specified with the RED (absence assertion) authored FIRST — NOT an
  Iron-Rule violation.
- **`/` index → Pipeline landing.** `routes.ts` repoints the `index(...)` entry to
  `routes/home.tsx` (`HomeRedirect`), which resolves the org's default (first) project
  off the AppShell outlet context and redirects to `projects/:projectId/pipeline`; zero
  projects → `/projects` (never strand); loading → a `home-resolving` placeholder
  (DWD-M4-5). Chat is no longer a top-level page; `/chat/:channelId` still maps to
  `routes/chat.tsx` (loader + `ChatView` retained), and `sessions` / project / dataset
  / view / report detail / `query-engines` routes are unchanged — no stranded
  deep-links. `root.test.tsx` welcome-panel + SSR tests and `chat.test.ts` loader tests
  stay green.
- **No backend change.** Pure-frontend slice.

## Adaptations from the standard nw-deliver flow (per-MR frontend slice)
- **DWD-M4-D1 — Acceptance gate is vitest, not a Python suite.** No pytest acceptance
  suite exists or was created for MR-4 (mirrors MR-1/2/3). Phase-3.5's
  `pytest tests/acceptance/{feature}` substituted by the vitest suite + full-suite
  green gate.
- **DWD-M4-D2 — Phase-3.5 Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories
  exist for this feature, so there is no `After: run … → sees …` line to execute
  (mirrors MR-1/2/3). Skipped (not applicable), not bypassed.
- **DWD-M4-D3 — Phase 3 dedicated refactor pass skipped.** The adversarial reviewer
  confirmed the diff clean at L1–L4 (small presentational components + a thin shell
  mount + a pure redirect resolver; shared `AssistantSurfaceProps` already extracted to
  `types.ts`, the feed/controls already shared by both surfaces — no duplication worth
  extracting, no dead code). A separate RPP pass adds no value (mirrors MR-1/2/3).
- **DWD-M4-D4 — Phase 5 mutation testing skipped.** The slice is presentational
  components + a redirect resolver whose behavior is fully pinned by the 13 example
  cases (incl. open/close toggle, dark/light branch, FAB-hidden, recents navigation,
  redirect branches, breadcrumb absence). Mutation on this surface is low-value; logged
  skip (mirrors MR-1/2/3).
- **DWD-M4-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed*
  feature to `docs/evolution/`. MR-4 is 4 of 8; finalize runs after MR-8. MR-4 lands
  incrementally via `gt mq submit` (CLAUDE.md trunk-based workflow). No
  deliver-session marker was created (the steps were driven inline with manual
  `log_phase` instrumentation), so none needed cleanup.
- **DWD-M4-D6 — DES log path quirk + committed location.** DES derives the log path
  from `DES-PROJECT-ID`; with `DES-PROJECT-ID=pipeline-layers-ui-redesign-mr4` the live
  trace was written under a transient `docs/feature/pipeline-layers-ui-redesign-mr4/deliver/`.
  To keep the committed record under the real feature folder (and not clobber MR-1/2/3
  records), the authoritative log + roadmap were consolidated into **`deliver/mr4/`**
  and the transient top-level dir removed (not committed). Integrity verified before
  consolidation (exit 0).
- **DWD-M4-D7 — RED_UNIT logged SKIPPED across all three steps.** The DISTILL-authored
  example cases ARE the unit/acceptance spec for this presentational slice; no
  additional internal seam warranted a separate micro-test. Each step logged
  `RED_UNIT SKIPPED NOT_APPLICABLE` (mirrors the MR-2/MR-3 pattern).

## Known non-blocking nit (deferred)
- The light glass overlay and dark TUI terminal currently differ only in chrome class +
  header label; the comic halftone / Baloo heading / Ben-Day detail and the terminal
  monospace prompt styling are token/CSS-level and asserted by neither happy-dom test
  (DWD-M4-2). Visual fidelity is deferred to the MR-8 Playwright/visual pass, as planned.

## Carry-forward
- **MR-5** (model detail recomposition) lands on the same `view/:id` / `report/:id` /
  `table/:id` routes; the assistant overlay it sees is now the MR-4 reshell.
- **MR-8** visual/contrast pass (Playwright) verifies the glass/comic (light) and
  Solarized TUI (dark) assistant chrome that happy-dom cannot assert (DWD-M4-2), and the
  live dark-mode toggle → terminal reactivity (`useIsDark` observer) end-to-end.
- A future MR removes the breadcrumb's remaining Query-Engines interim affordance once
  query-engines gets a permanent home.
