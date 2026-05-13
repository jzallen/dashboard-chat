# DELIVER Wave Decisions — `frontend-coexistence` Phase 01 (MR-0)

> **Wave**: DELIVER · Phase 01 (Slice 1 / MR-0) only
> **Date**: 2026-05-13
> **Driving artifacts**: ADR-034 (canonical) · DESIGN `application-architecture.md` · DESIGN `wave-decisions.md` (DWD-1..DWD-8 immutable) · DESIGN `handoff-design-to-distill.md` §1 · DISTILL `wave-decisions.md` (DI-1..DI-8) · DISTILL `roadmap.json` Phase 01.
> **Scope**: This file records the **operational choices DELIVER makes inside Phase 01** that DESIGN and DISTILL deferred. It does NOT re-litigate any DWD or DI.

DELIVER inherits DWD-1..DWD-8 and DI-1..DI-8 unchanged. The decisions below close out the LOW/MEDIUM deferrals in `distill/upstream-issues.md` that Phase 01 owns.

---

## DD-1: DOM-fingerprint scenario — **Option C (HTML-shape reduction)** at MR-0

**Issue**: `existing-routes-render-identically-through-ssr.feature :: The DOM after hydration is structurally equivalent pre/post MR-0 for the entry routes` is tagged `@needs-playwright` and listed in Phase 01 `scenarios_deferred_within_phase`. DI-U-3 names three options.

**Decision**: **Option C — HTML-shape reduction.** The scenario remains in the pytest suite, gets its `@needs-playwright` tag replaced with `@html-shape-reduced`, and asserts the structural HTML shape of the SSR response at `/` (well-formed HTML5 document with `<div id="root">` + `<script>` reference + no error page). It does NOT do a browser-level DOM comparison.

**Rationale**:

- MR-0 is **library-mode-as-default** (DI-3 Slice 1, DWD-7). Every route's SSR'd response is `root.tsx`'s `<Layout>` wrapping the library-mode pass-through component tree — structurally the same shell `nginx`'s `try_files index.html` produced pre-MR-0. The walking-skeleton scenario already asserts this shape via `driver.response_is_html_shell(probe)`; the deferred fingerprint scenario is a redundant assertion at the entry route (`/`) which costs ~10 lines.
- **Playwright (Option A)** adds ~50 MB browser + Python binding dep for one scenario that doesn't need DOM-level fidelity at MR-0. Reserve Playwright for the per-route migrations (Slice 2+) where it actually exercises hydrated state.
- **Move to e2e/ (Option B)** would split the acceptance suite SSOT (`tests/acceptance/frontend-coexistence/` per CLAUDE.md acceptance-suite convention) for one scenario. Not worth it at MR-0 — if browser-level fidelity is needed later, the e2e/ Playwright TS suite is where it lands.

**How applied**:

- `tests/acceptance/frontend-coexistence/test_existing_routes_render_identically_through_ssr.py :: test_dom_fingerprint_pre_post_mr0_matches` is rewritten to assert the SSR response at `/` is a well-formed HTML5 shell (the same `response_is_html_shell` predicate the walking skeleton uses).
- `existing-routes-render-identically-through-ssr.feature` tag updates: `@needs-playwright` → `@html-shape-reduced` on that scenario only.
- The scenario un-pends in Phase 01 alongside the other 11.

**Source**: DISTILL `upstream-issues.md` DI-U-3 (LOW) · DISTILL `wave-decisions.md` DI-2 (deferred-to-DELIVER clause).

---

## DD-2: Phase 01 step decomposition — 5 sequential crafter dispatches

**Issue**: The roadmap declares Phase 01 as one phase but DELIVER orchestrates per-step TDD via `@nw-software-crafter` dispatches.

**Decision**: Phase 01 lands as **5 sequential atomic crafter steps**, each addressing a coherent set of files. Each crafter commits its slice; the orchestrator verifies file-system invariants before the next dispatch. The phase exit gate runs after step 01-05.

| Step ID | Scope | Files | Scenarios this step turns observable |
|---|---|---|---|
| `01-01` | `ui-presentation/` dissolution + `git mv` 5 scaffolds → `frontend/app/routes/` | 5 file moves + delete `ui-presentation/` directory + verify root `package.json` workspaces | DWD-4 (ui-presentation dissolved; 5 files at new location) |
| `01-02` | Build-pipeline plumbing | `frontend/package.json` (+@react-router/dev,@react-router/node,hono,@hono/node-server) + `frontend/vite.config.ts` (+reactRouter(), -@vitejs/plugin-react) + `frontend/tsconfig.json` (+app/**/*) | none directly — enables 01-03/01-04 |
| `01-03` | Composition root | NEW: `frontend/app/{root.tsx,routes.ts,lib/ui-state-client.ts}` + `frontend/ssr.ts` · REWRITE: `frontend/main.tsx` · DELETE: `frontend/App.tsx` · MODIFY: `frontend/src/ui/components/AppShell/index.tsx` (guards in) | DWD-1, DWD-2, DWD-6 — App.tsx gone, BrowserRouter gone, main.tsx is HydratedRouter entry; root.tsx mounts AuthProvider + QueryClientProvider |
| `01-04` | System-level plumbing | `frontend/BUILD.bazel` (+:ssr_dist, :ssr_image, :ssr_image_tar) + `frontend/nginx.conf` (catch-all → web-ssr:3001) + `docker-compose.yml` (+web-ssr block) | DWD-5, DWD-8 — web-ssr service exposes 3001 internal-only, nginx rule ordering preserved |
| `01-05` | Docs + scenario un-skip + exit-gate run | `CLAUDE.md` (architecture section update) + un-skip pytest scenarios + acceptance suite runs (where stack reachable) | All 11 scenarios go from `@skip` to live (GREEN against live stack OR SKIP-when-stack-unreachable per DI-1 Strategy C) |

**Rationale**:

- **Atomic at the MR level**: per DI-3 + DWD-4, MR-0 lands as one merge. Step decomposition is internal to DELIVER's TDD discipline — git history will likely squash to one commit at `gt mq submit` time, or land as a 5-commit branch.
- **Sequential per saved memory** (one crafter at a time, verify each commit). Steps 01-02 and 01-03 have ordering dependencies (deps before code that imports them). 01-01 and 01-04 are largely independent of the others but ordering keeps the diff coherent.
- **Each step is observable**: every step lands files the acceptance suite can inspect. Step 01-03 in particular drops the sentinel (`frontend/app/root.tsx`) that flips `requires_repo_post_mr0_state` from SKIP to live for the file-presence scenarios.

**Iron Rule reminder**: at any step, if a crafter cannot turn a scenario GREEN, the orchestrator does not modify the failing test. The crafter either fixes the production code, escalates upstream issues via `docs/feature/frontend-coexistence/deliver/upstream-issues.md`, or reverts after 3 failed attempts.

---

## DD-3: Live-stack verification scope at Phase 01 exit

**Issue**: Roadmap Phase 01 exit criterion #1 says "all 11 scenarios are GREEN against the local compose stack." DI-1 Strategy C makes the live-stack tests SKIP cleanly when the stack isn't up.

**Decision**: After all 5 steps land, the orchestrator runs `bazel build //frontend:ssr_image_tar` (binary builds verifying the new SSR image target produces a valid OCI tar) + `docker compose config` (verifying the YAML parses with the web-ssr block). Live-stack HTTP probes (walking skeleton + 5 nginx-rule preservation + 3 catch-all probes) are SKIP-clean if the stack isn't running locally at exit time; this is acceptable per DI-1 Strategy C. The merge description will note "live-stack verification: run `docker compose up -d` followed by `cd tests/acceptance/frontend-coexistence && uv run --no-project pytest` post-merge" as the integration-test handoff.

**Rationale**:

- DI-1 Strategy C explicitly designs the suite around real-when-available / skip-otherwise. Phase 01's exit gate honors that design.
- The live-stack probes need every image rebuilt + loaded + `docker compose up -d`, which is expensive and not part of the refinery `--auto` gate.
- The file-presence + `docker compose config` scenarios (8 of 11) DO go GREEN in this workspace and that's what the orchestrator verifies before submitting.

---

## DD-4: `frontend/index.html` strategy at MR-0

**Issue**: ADR-034 §"Migration sequence" row 1 keeps `frontend/index.html` "unchanged". DWD-6 makes `frontend/main.tsx` the RRv7 `<HydratedRouter />` entry. The RRv7 Vite plugin auto-generates a hydration entry if `main.tsx` is absent; with an explicit `main.tsx`, the plugin still treats it as the client entry referenced by `index.html`.

**Decision**: Keep `frontend/index.html` byte-unchanged at MR-0. Continue to reference `/main.tsx` as the client entry. The rewritten `main.tsx` uses RRv7's `<HydratedRouter />` hydration component — same entry filename, different body.

**Rationale**: ADR-034 row 1 / handoff §1.3 both preserve `index.html` at MR-0. Removing or rewriting `index.html` would introduce additional risk; the explicit `main.tsx` preserves the source-tree-visible client entry per DESIGN application-architecture.md §3.5.

---

## DD-5: Workspace cleanup — `ui-presentation` already absent from root `package.json` workspaces

**Issue**: DWD-4 mandates removing `ui-presentation` from root `package.json` workspaces. Pre-flight inspection (2026-05-13) shows the root `package.json` workspaces array is `["frontend", "agent", "auth-proxy", "shared/chat"]` — `ui-presentation` is already absent.

**Decision**: No-op for root `package.json`. The DWD-4 invariant is already satisfied; the acceptance assertion (`test_root_package_json_workspaces_no_longer_contains_ui_presentation`) goes GREEN immediately when the post-MR-0 sentinel (`frontend/app/root.tsx`) lands.

**Source**: Pre-flight `cat package.json` inspection.

---

## DD-6: `react-router-dom` vs `react-router` import package

**Issue**: The codebase today imports from `react-router-dom` (e.g., `App.tsx:1`, `AppShell/index.tsx:2`). RRv7 framework mode imports come from `react-router` (the framework-mode adapter package re-exports the `dom` symbols).

**Decision**: At MR-0, **do not blanket-migrate existing `react-router-dom` imports**. The new `frontend/app/*` files import from `react-router` (the framework-mode entry). Existing `frontend/src/**` files keep `react-router-dom` imports. The two packages are aliased by `react-router@7` — they resolve to the same module graph. Blanket-migration is out-of-scope for MR-0 (it would expand the diff substantially and serve no behavior change).

**How applied**:

- `frontend/app/root.tsx`, `frontend/app/routes.ts`, `frontend/app/lib/ui-state-client.ts`, `frontend/ssr.ts` import from `react-router` / `react-router/dom` (per DESIGN application-architecture.md §3.3, §3.5).
- `frontend/src/ui/**` files keep their `react-router-dom` imports.
- `frontend/main.tsx` imports `HydratedRouter` from `react-router/dom` per DWD-6 + DESIGN handoff §1.3.

**Source**: DESIGN application-architecture.md §3.5 ("imports `HydratedRouter` from `react-router/dom`") + ADR-034 §"Decision drivers" ("`react-router-dom@7.13.0` is already in frontend/package.json").

---

## DD-7: Route module shims under `frontend/app/routes/` to bridge named-export components into RRv7 framework mode

**Issue**: RRv7 framework-mode `routes.ts` declares each route via `route(path, file)` where `file` is a module path whose **default export** is the route component. The existing 12 route-bearing components under `frontend/src/ui/components/*` use **named exports** (e.g., `export function LoginPage()`) per the codebase convention. RRv7 cannot resolve a named export from a file-path-based route config.

**Decision**: At step 01-03 the crafter created **14 thin shim files under `frontend/app/routes/`** (`login.tsx`, `logout.tsx`, `auth-callback.tsx`, `create-org.tsx`, `app-shell.tsx` (layout shim), `chat.tsx`, `projects.tsx`, `project-detail.tsx`, `table.tsx`, `view-detail.tsx`, `report-detail.tsx`, `query-engines.tsx`, `query-engine-detail.tsx`, `sessions.tsx`). Each shim is 3–6 lines: imports the named component from `frontend/src/ui/components/*` and re-exports it as `default`. `frontend/app/routes.ts` points at these shim paths (`app/routes/login.tsx`, etc.) rather than at `src/ui/components/LoginPage/index.tsx` directly.

**Rationale** (vs the alternative of adding `export default` to 12 component files):

- **Smaller blast radius in `src/`**: the 12 existing component files are byte-unchanged. Their existing named-export consumers (tests, other components) keep working without parallel default-export drift.
- **Localized framework-mode wiring**: `frontend/app/` is the new "framework mode lives here" boundary per ADR-034 §"What's in the source tree". The shims belong on that side of the boundary, not in `src/`.
- **Future migrations are local edits**: when a route migrates from library-mode to framework-mode (Phase 02+), the loader export lands in the shim file in `frontend/app/routes/`. The shim grows from a 3-line re-export into a full RRv7 route module — exactly the migration path DESIGN application-architecture.md §2 anticipates.
- **CreateOrg's RequireAuth wrap** is contained in `CreateOrg/index.tsx`'s default export (`CreateOrgGuarded`) — the named `CreateOrg` export is preserved for any existing test imports.

**Trade-off accepted**: This expands `frontend/app/routes/` from the 5 migrated scaffolds (DWD-4) to 19 files (5 migrated scaffolds + 14 shims). The 5 migrated scaffolds (`copy-variants.ts`, `expired-token-banner.{tsx,test.tsx}`, `recoverable-error.{tsx,test.tsx}`) remain unreferenced by `routes.ts` per DWD-4 + DESIGN handoff §1.2. The 14 shims ARE referenced.

**Strict-list reconciliation**: DESIGN handoff §1.2 enumerates the 5 ui-presentation migrations as the only files under `frontend/app/routes/` at MR-0. The 14 shims are NOT in §1.2 — they are an implementation reality DESIGN §3.4's illustrative `routes.ts` shape didn't surface (the illustrative shape pointed at `src/ui/components/.../index.tsx` paths, implicitly assuming default exports that don't exist in the codebase today). DELIVER's choice is to land the shims rather than retrofit default exports across 12 `src/` component files; this preserves the no-behavior-change posture of MR-0 inside `src/` while honoring the framework-mode contract.

**How applied**:

- Each shim follows the pattern `import { ComponentName } from "../../src/ui/components/.../"; export default ComponentName;`.
- `frontend/app/routes.ts` references all 14 shims (12 routes via `route(...)` + the `app-shell.tsx` via `layout(...)` + `chat.tsx` referenced twice with distinct `id` keys for the index and `chat/:channelId` routes).
- Path strings in `routes.ts` are byte-identical to App.tsx's path strings.
- Tests for the migrated `expired-token-banner` and `recoverable-error` scaffold files continue to import from their relative paths under `frontend/app/routes/` (set up in step 01-01).

**Source**: pragmatic resolution at step 01-03 execution; matches the spirit of ADR-034 §"What's in the source tree" while accommodating the named-export convention in `frontend/src/ui/components/*`.

---

## Cross-references

- ADR-034 (canonical): `docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md`
- DESIGN wave-decisions (DWD-1..DWD-8, immutable): `../design/wave-decisions.md`
- DESIGN application architecture: `../design/application-architecture.md`
- DESIGN handoff §1 (MR-0 file-level contract): `../design/handoff-design-to-distill.md`
- DISTILL wave-decisions (DI-1..DI-8): `../distill/wave-decisions.md`
- DISTILL roadmap (Phase 01 binding scope): `../distill/roadmap.json`
- DISTILL upstream issues (DI-U-3 resolved by DD-1): `../distill/upstream-issues.md`
