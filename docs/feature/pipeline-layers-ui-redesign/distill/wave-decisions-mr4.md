# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-4

Slice: **MR-4 — Assistant FAB / glass overlay (light) + docked TUI terminal (dark);
`/` index swap to the Pipeline landing.**
Scope/decision source: `../path-forward.md` §2.4 (Assistant FAB → glass overlay /
docked TUI terminal — pure-frontend reshell of existing chat plumbing), §4.2 (route
table: `/` index → Pipeline; chat becomes an everywhere-overlay), §4.4 (Assistant
module mounts at shell level as a sibling of `<Outlet/>`), §5 MR-4, §9 (single
Neobrutalist + Solarized `.dark`; comic light / TUI dark assistant).
DESIGN-equivalent SSOT — no `docs/product/` and no DISCUSS user-stories exist for
this feature (mirrors MR-1 DWD-6 / MR-2 / MR-3). MR-4 artifacts are namespaced `-mr4`
so the MR-1/2/3 DISTILL/DELIVER records are preserved unchanged.

Prior-wave reading (READING ENFORCEMENT):
- `+ docs/feature/pipeline-layers-ui-redesign/path-forward.md` (§2.4, §4.2, §4.4, §5, §9)
- `+ docs/feature/pipeline-layers-ui-redesign/design-sources.md`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/roadmap-mr3.json`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/wave-decisions-mr3.md`
- `+ docs/feature/pipeline-layers-ui-redesign/deliver/wave-decisions-mr3.md`
- `- docs/product/journeys/*.yaml` (not found — no DISCUSS for this feature)
- `- docs/product/architecture/brief.md` (not found — path-forward.md is the DESIGN SSOT)
- `- docs/product/kpi-contracts.yaml` (not found)
- `- docs/feature/pipeline-layers-ui-redesign/discuss/*` (not found)
- `- docs/feature/pipeline-layers-ui-redesign/devops/*` (not found — default env matrix N/A; pure-FE vitest slice)

Wave-decision reconciliation: **0 contradictions.** MR-1 delivered the token layer
(`frontend/app/theme/`, `AESTHETIC_CLASS`/`DARK_CLASS`/`applyThemeClass`) the
assistant chrome consumes and whose `.dark` class the render branch keys off; MR-2
delivered the Pipeline landing (`projects/:projectId/pipeline`) the `/` index now
redirects to; MR-3 delivered the breadcrumb whose interim utility menu (New Session /
All Chats) MR-4 was explicitly chartered to absorb (MR-3 DWD-M3-4 / deliver
carry-forward: "MR-4 … ABSORBS the breadcrumb's interim utility menu"). All three are
carry-forwards anticipated by the prior MRs.

---

## DWD-M4-1 — Walking Skeleton Strategy: C (real local I/O), vitest-gated
**Decision:** Strategy C — frontend-only, no backend/external/costly deps (mirrors
MR-1 DWD-D1 / MR-2 DWD-M2-1 / MR-3 DWD-M3-1). The ports MR-4 touches are the
**existing chat context** (`useChatContext` — the chat-feed driving surface), the
**dataCatalog sessions hook** (`useSessions` — the recents data port), and the
**rendered route surface** (FAB toggle + overlay/terminal + index redirect). The
acceptance gate is the **vitest** suite (`happy-dom`), NOT a pytest acceptance suite —
none exists for this feature and none was created. The walking-skeleton thin slice is
the FAB→overlay→feed scenario (`Assistant.test > "shows the streamed messages and the
chat input inside the overlay"`) — a real FAB click → real overlay render → the
EXISTING chat context (doubled at the boundary) rendered through the real MessageList
+ ChatInput. Pre-baked per the headless run brief; not gated on an interactive WS
confirmation.

## DWD-M4-2 — happy-dom limitation: assert STRUCTURE, not computed colors
**Decision:** happy-dom does **not** apply stylesheets, so the MR-4 tests assert
testids, message text, navigation (via `createRoutesStub`), the FAB open/close
toggle, and the dark→terminal / light→glass STRUCTURAL branch — **never** computed
colors or the MR-1 token values. The comic/halftone/Solarized pixel + contrast detail
is deferred to the MR-8 Playwright/visual pass (mirrors MR-1 DWD-D3 / MR-2 / MR-3
DWD-M3-3).

## DWD-M4-3 — Pure presentation reshell: the ui-state wire is NOT touched
**Decision (load-bearing, saved-feedback constraint):** the FAB/overlay/terminal are
NEW components that consume the **existing** `ChatProvider` (`useChatContext`) +
`StreamProvider` machinery unchanged. No new chat/stream client is instantiated; no
`@dashboard-chat/ui-state-wire` / `lib/ui-state-client` import is added; the agent
contract and ui-state transport are untouched. Recents come from the existing
`useSessions` hook (the `listSessions` port SessionList/UnifiedNav already use);
"All Chats" is the existing `/sessions` route. MR-4 only re-skins the consumer
(path-forward §4.4).

## DWD-M4-4 — Dark-mode render branch reads the authoritative `.dark` root class
**Decision:** the locked design renders the assistant as a glass/comic overlay in
light mode and a docked TUI terminal in dark mode (path-forward §2.4/§9) — a
**structural** branch, not just a CSS reskin. The branch is `dark ? <TerminalAssistant/>
: <GlassOverlay/>`. The dark flag is obtained from a small `useIsDark()` hook that
reads the **`dark` class applied to `document.documentElement`** (the authoritative
flag `theme.ts`/`applyThemeClass` writes — MR-1) via `useSyncExternalStore` +
`MutationObserver`, NOT by calling `useTheme()` a second time. Rationale: two
independent `useTheme()` instances do not share state (each seeds its own `useState`
from `localStorage`), so a second `useTheme()` in the assistant would not react to the
org-sheet `ThemeToggle`. Reading the applied root class makes the assistant flip the
moment dark mode is toggled anywhere. SSR-safe (`getServerSnapshot` → light). This is
a documented adaptation of the brief's "switch off the dark-mode flag from
useTheme()" — same authoritative flag, made cross-instance reactive.

## DWD-M4-5 — `/` index → Pipeline landing; client-side default-project resolution
**Decision:** MR-4 swaps the `/` index from chat (`routes/chat.tsx`) to a new
`routes/home.tsx` (`HomeRedirect`) that resolves the org's **default (first) project**
off the AppShell outlet context and redirects to `projects/:projectId/pipeline`
(path-forward §4.2). Branches:
- projects present → `<Navigate to="/projects/<first>/pipeline" replace />`;
- zero projects → `<Navigate to="/projects" replace />` (never strand the user; the
  projects route shows the list/empty state — and root.tsx already renders the
  `no_projects` welcome panel before the Outlet for the truly-empty org);
- projects still loading (`null`) → a `home-resolving` placeholder.

**Why client-side, not a server loader:** the Pipeline graph is built from the
dataCatalog REST hooks, and server-side dataCatalog fetching was deliberately deferred
(MR-2 DWD-M2-2), so a server index loader would have nothing to read. Resolving off
the outlet context (the same first-project fallback `AppShell`/`ChatView`/`SessionList`
already use) is the consistent choice. `routes.ts` repoints ONLY the `index(...)`
entry; `chat/:channelId`, `sessions`, project/dataset/view/report detail, and
`query-engines` stay registered and reachable (no stranded deep-links). The
`routes/chat.tsx` loader + `ChatView` remain for `/chat/:channelId`.

## DWD-M4-6 — Breadcrumb absorbs its interim session controls into the assistant
**Decision (supersedes MR-3 DWD-M3-4, NOT an Iron-Rule violation):** MR-3's interim
`breadcrumb-utility` menu carried **New Session**, **All Chats (`/sessions`)**, and
**Query Engines (`/query-engines`)** as an anti-strand stopgap "until MR-4." MR-4 moves
New Session + recents + All Chats into the assistant overlay, so the breadcrumb's menu
is **reduced to Query Engines** (which still needs a path until a later MR). The
breadcrumb drops its `useChatContext` import (no longer owns New Session). This is a
deliberate re-spec of superseded interim behavior — the RED is authored FIRST: the
updated `Breadcrumb.test.tsx` replaces the two removed positive cases with an
**absence** assertion (`utility-new-session` / `utility-sessions` must be null) that is
RED against the current breadcrumb and goes GREEN when DELIVER removes those buttons.

## DWD-M4-7 — Assistant mounts at shell level (re-spec of AppShell)
**Decision:** `AppShell` renders `<Assistant projects={projects} />` as a sibling of
`<main><Outlet/></main>` inside the existing `StreamProvider`+`ChatProvider` wrap
(path-forward §4.4) so it floats over every view and can consume the chat context. The
RED is authored first: `AppShell.test.tsx` gains a case asserting the shell mounts
`assistant` (stubbed) — RED now (the shell does not yet render it), GREEN when DELIVER
wires it. The FAB **hides while the org sheet is open** (`?org=1`) so it never overlaps
the sheet (path-forward §4.1).

## DWD-M4-8 — Mandate 7 scaffolding (TypeScript), verified RED
**Decision:** RED-ready scaffolds, each marked `__SCAFFOLD__`, component/hook bodies
`throw new Error("Not yet implemented — RED scaffold …")` (NOT `NotImplementedError`,
so they read RED not BROKEN):
- `frontend/src/ui/components/Assistant/{index,GlassOverlay,TerminalAssistant,AssistantControls,AssistantFeed}.tsx`
- `frontend/src/ui/components/Assistant/useIsDark.ts`
- `frontend/src/ui/components/Assistant/Assistant.module.css` (real CSS consuming MR-1
  tokens — CSS cannot scaffold-throw)
- `frontend/app/routes/home.tsx` (`HomeRedirect`)
**Verified RED (not BROKEN):** the MR-4 cases fail with the scaffold marker / the
authored absence+mount assertions, **zero import/resolve errors** — all 24 collected
cases ran (`npx vitest run src/ui/components/Assistant/Assistant.test.tsx
app/routes/home.test.tsx src/ui/components/AppShell/AppShell.test.tsx
src/ui/components/Breadcrumb/Breadcrumb.test.tsx` → 13 failed / 11 passed). The 13 RED
= Assistant 8 + home 3 + AppShell 1 (new mount case) + Breadcrumb 1 (absence case);
the 11 passes are the unchanged AppShell/Breadcrumb cases. DELIVER replaces the bodies
(GREEN) and removes the markers (grep → empty at done).

## DWD-M4-9 — Test-boundary decisions (port-to-port, isolation)
- **Driving port:** the rendered assistant route surface, exercised through
  `createRoutesStub` at real paths (`/`, `/?org=1`) with real destination routes
  (`/sessions`, `/chat/:channelId`). The history control and recent chips assert
  **real navigation** (the destination renders), not a spy call — proving the wiring,
  not merely that a button exists.
- **Chat-feed port (driven):** `useChatContext` doubled at the boundary (mirrors
  `ChatView.test`). The feed renders the REAL `MessageList`/`ChatInput`, so the test
  proves the overlay actually surfaces the context's messages + input (`chat-input`
  testid) — not a stub.
- **Recents port (driven):** `useSessions` doubled at the boundary (mirrors
  `SessionList.test`). No new driven adapter with real network I/O is introduced (the
  REST client is contract-tested under `src/core/dataCatalog/__tests__/`), so no new
  `@real-io @adapter-integration` HTTP scenario is added here (mirrors MR-2/MR-3).
- **Dark branch driven by the DOM:** `useIsDark` reads the real `document.documentElement`
  class the tests set directly — the same applied flag MR-1's `applyThemeClass` writes.
- **AppShell glue tested with the assistant stubbed:** `AppShell.test` stubs
  `../Assistant` and asserts only the mount; the assistant's own behavior is covered by
  `Assistant.test` (keeps the heavy shell wiring as thin, verifiable glue — mirrors the
  MR-3 stub-the-children approach).

## DWD-M4-10 — Single Neobrutalist + Solarized `.dark`; no aesthetic switcher
**Decision:** the FAB, glass overlay, and TUI terminal consume the MR-1 `--color-*` /
`--border-width` / `--radius` / `--shadow` tokens via the CSS module; no `.theme-*`
aesthetic selector is added (path-forward §9 — Option A locked). The only appearance
control remains the dark-mode `ThemeToggle` in the org sheet; the assistant's
glass↔terminal switch is derived from that toggle's applied `.dark` class (DWD-M4-4).

---

## Adapter coverage table (Mandate 6)
| Adapter | @real-io scenario | Covered by |
|---------|-------------------|------------|
| chat context (`useChatContext` — feed/stream surface) | N/A — pre-existing provider over StreamProvider; not re-wired by MR-4 | doubled at the port in `Assistant.test` (mirrors `ChatView.test`) |
| dataCatalog sessions hook (`useSessions` — recents) | N/A — pre-existing client; contract-tested under `src/core/dataCatalog/__tests__/` | doubled at the port in `Assistant.test` (mirrors `SessionList.test`) |

No new driven adapter with real network I/O is introduced by MR-4 → no
`NO — MISSING` rows.

## Self-review checklist
- [x] WS strategy declared (DWD-M4-1).
- [x] Gate is vitest (`happy-dom`); structure/navigation asserted, not colors (DWD-M4-2).
- [x] No new driven adapter → no missing @real-io scenario (table above).
- [x] InMemory/double limits documented: happy-dom can't model CSS cascade/computed
      tokens/paint; the doubled chat + sessions ports can't model real SSE latency /
      network errors (deferred to existing chat/stream tests + MR-8 visual pass).
- [x] Mandate 7: every imported production module has a `__SCAFFOLD__` stub; bodies
      throw `Error` (RED, not `NotImplementedError`/ImportError); **13/13 MR-4 cases
      verified RED**, 0 BROKEN (all 24 collected ran).
- [x] No `__SCAFFOLD__` expected to remain after DELIVER (grep gate in roadmap).
- [x] Driving-adapter: the FE has no CLI/HTTP/hook entry point; the user's invocation
      path is the rendered route surface, exercised via `createRoutesStub` at real
      paths with real navigation destinations (FE analog, mirrors MR-2/MR-3).
- [x] Error/edge coverage ≥ 40%: of 13 MR-4 cases, the non-happy-path / branch
      coverage — overlay-closed default, close-again toggle, dark→terminal branch,
      light→glass branch, FAB hidden under `?org=1`, zero-projects redirect, loading
      placeholder, breadcrumb absence (controls moved) — comfortably exceeds 40%.
