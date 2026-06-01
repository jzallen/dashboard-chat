# Wave Decisions — MR-8 (aesthetic polish / final refactor pass)

**Wave:** nw-refactor (RPP L1–L6, behaviour-preserving). **Date:** 2026-06-01.
**Scope:** path-forward §2.8 / §4.3 / §5 (MR-8) / §9. Frontend-only. ui-state wire
untouched, backend untouched. NO aesthetic switcher (locked single Neobrutalist
light + Solarized dark, §9 Option A). This is the **last build slice** of the
redesign; `nw-finalize` is intentionally NOT run (deferred (c) items UI-5/6/7/8
remain — see distill/upstream-issues.md).

Safety net: the existing vitest suite (**98 files / 789 tests** at baseline, green).
happy-dom does not apply stylesheets, so NO color-assertion tests were added (that
would be theater). Structural tests (testids/structure/values/navigation) stayed
green after every pass; the colour/contrast safety net is (a) WCAG contrast math on
the token hex values and (b) a real-Chromium Playwright token-harness pass (below).

---

## 1. What was migrated (token migration — the core)

All eight remaining hardcoded-hex CSS modules were migrated from hardcoded values
+ non-dark-aware Tailwind colour utilities to MR-1 `var(--…)` token references,
following the established MR-2..MR-7 idiom (plain-CSS colour + `@apply` retained for
layout/spacing only). One atomic commit per component/cluster; the relevant vitest
ran green before each commit.

| # | Component (CSS module) | Traffic | Commit |
|---|---|---|---|
| 1 | `chat/chat.module.css` | high (assistant/chat surface) | `style(chat): …` |
| 2 | `TableView/TableView.module.css` | high (data grid chrome) | `style(table-view): …` |
| 3 | `DatasetView/DatasetView.module.css` | high (detail chrome) | `style(dataset-view): …` |
| 4 | `DatasetView/SchemaTable/SchemaTable.module.css` | high (schema grid) | `style(schema-table): …` |
| 5 | `TablePanel/TablePanel.module.css` + `Pagination/` + `ActiveFilters/` | high (data grid) | `style(table-panel): …` |
| 6 | `SqlAccessPanel/SqlAccessPanel.module.css` | lower (query-engine panel) | `style(sql-access-panel): …` |

**Verification:** after Pass 6, `grep -rE '#[0-9a-fA-F]{3,8}' --include=*.module.css`
across the eight targets returns NONE (only the modal scrim `rgba(0,0,0,.5)` remains,
which is correct in both modes). The JSX of these components carries **no inline
Tailwind colour utilities** (audited) — so CSS-module migration fully covers their
dark-mode reskin; no JSX/behaviour edits were needed.

### Decisions inside the migration
- **Idiom:** kept `@apply` for layout/spacing/typography (no colour, dark-safe),
  moved every colour-bearing utility + hex into plain `var(--…)` declarations. This
  minimises layout-regression surface (happy-dom can't catch a layout regression) and
  matches ModelDetail/Assistant/Pipeline (the already-migrated components).
- **Non-dark-aware Tailwind dividers** (`divide-y divide-gray-200`, `divide-gray-100`)
  were replaced with explicit token borders (`.tr + .tr { border-top: 1px solid
  var(--color-border) }`) so the grid dividers reskin under `.dark`.
- **Custom Tailwind theme colours** in SqlAccessPanel (`surface-*`, `primary`,
  `accent-*`, `semantic-*`) are fixed-value (defined in `tailwind.config.js`) and do
  NOT adapt to `.dark`; they were swapped for `var(--…)` tokens. `tailwind.config.js`
  itself was deliberately **NOT** remapped to the CSS variables — that would change the
  blast radius across the whole app (incl. unaudited components); a per-module swap is
  the controlled, reviewable choice. Retiring the fixed Tailwind theme colours wholesale
  is left as a future opportunistic follow-up (see §5).
- **Categorical colour** (SchemaTable type badges, ActiveFilters chips, status chips)
  was preserved using `color-mix(in srgb, var(--token) 14–16%, transparent)` tints over
  a same-hue token border/text, so each category keeps a distinct hue AND stays
  AA-legible in both modes.
- **Focus rings** that used Tailwind `ring-*` utilities (not token-able via `@apply`)
  became token `outline` rules (`outline: 2px solid var(--color-primary)`).
- **Button hovers** that referenced a `*-hover` Tailwind colour became
  `filter: brightness(0.93)` (mode-agnostic) since the token layer has no `*-hover`
  token — keeps the hover affordance without inventing a token.

---

## 2. Dark-mode contrast fixes (WCAG AA)

The redesign's dark palette had real gray-on-gray bugs. Fixes were made by adjusting
the `.dark` token values in `tokens.css` (commit `style(theme): add semantic tokens +
fix dark-mode contrast to WCAG AA`). Because the migrated components consume these
tokens, fixing the token values fixes every consumer (including the already-migrated
MR-2..MR-7 components). Ratios computed with linearized-sRGB WCAG math (4.5:1 body /
3:1 large·UI):

### Existing dark tokens — FIXED
| token | was | →now | ratio before → after |
|---|---|---|---|
| `--color-muted` (dark) | `#586e75` (base01) | `#8c9d9e` | bg **2.79→5.31**, surface **2.42→4.60** (AA body ✓) |
| `--color-border` (dark) | `#586e75` | `#8c9d9e` | bg **2.79→4.75** as UI boundary (3:1 ✓) |
| `--layer-staging` (dark) | `#cb4b16` | `#dc5a23` | on surface **2.82→3.71** (3:1 ✓) |
| `--layer-mart` (dark) | `#d33682` | `#e0589b` | on surface **2.86→4.06** (3:1 ✓) |

`--color-ink` (`#93a1a1`, bg 5.61 / surface 4.86), `--accent-ink` on `--accent`
(4.68), `--layer-source` (4.08/3.53) and `--layer-intermediate` (4.69/4.06) already
passed and were left. `--color-muted` `#8c9d9e` was chosen as the lightest gray still
**dimmer than `--color-ink`** (preserves the muted↔ink hierarchy) that still clears
4.5:1 on BOTH base03 bg and the lighter base02 surface — avoids darkening `surface`
(which would have collapsed the card/bg distinction). The hard-offset `--shadow`
(= `--color-border`) picks up the brighter border automatically.

### New semantic tokens (additive — both modes, all AA as text on bg AND surface)
| token | light | dark | light bg/surf | dark bg/surf |
|---|---|---|---|---|
| `--color-primary` | `#2563eb` | `#4ca0db` | 4.64 / 5.17 | 5.26 / 4.56 |
| `--color-on-primary` | `#ffffff` | `#002b36` | on primary 5.17 | on primary 5.26 |
| `--color-success` | `#15803d` | `#93a30a` | 4.50 / 5.02 | 5.35 / 4.63 |
| `--color-danger` | `#b91c1c` | `#fa7a76` | 5.81 / 6.47 | 5.80 / 5.02 |
| `--color-warning` | `#b45309` | `#c99a2e` | 4.51 / 5.02 | 5.82 / 5.04 |

Light tokens were untouched (all already pass with large margins) — keeps light-mode
visual risk near zero. **No vitest colour assertion was added** (happy-dom can't honor
it); ratios above are the documented safety net, confirmed visually below.

---

## 3. Two assistant looks finalized (Comic light / TUI dark)

Confirmed the MR-4 `Assistant` already renders the two looks purely via tokens (light
glass/comic panel on `--color-surface`; dark docked terminal on `--color-bg` with a
monospace stack) and branches on `useIsDark`. No new behaviour and **no aesthetic
switcher** was added. The contrast fixes in §2 flow into the assistant chrome (muted
feed text, borders) automatically. Deeper comic-halftone / Ben-Day / Baloo styling
remains a token/CSS visual nicety the happy-dom tests can't assert and the design
prototype treats as flourish — left as opportunistic polish (not behaviour).

---

## 4. Deferred review nits (from MR-1..MR-7 wave-decisions)

Mined all seven prior wave-decisions files. Applied the safe **frontend code** nits;
the rest are either the planned Playwright pass itself or out-of-scope backend (c).

**Applied** (commit `test(theme): apply deferred MR-1 review nits` + the token commit):
- **MR-1 — Tailwind-mapping note in `tokens.css`.** Added a header note documenting the
  Tailwind↔token interplay (path-forward §4.3). ✓
- **MR-1 — AC1b containment assertions for the token constants.** `theme.test.tsx` AC1b
  now also asserts the pre-hydration script body contains `AESTHETIC_CLASS` and
  `DARK_CLASS` (not just the storage key) — happy-dom-honorable string checks. ✓
  (suite 9→10 tests)
- **MR-1 — SSR initial-state comment in `useTheme`.** Added documentation of the SSR
  seed / no-flash reconciliation in `theme.ts`. ✓

**Intentionally left** (documented, not applied):
- **MR-2/3/4/5/6/7 "Playwright verifies …" notes** — these ARE the visual pass; done as
  the best-effort token-harness pass (§6), not code changes.
- **MR-3 — `OrgSheet` accepts an `orgName` prop it does not render** ("one-line change
  later"). LEFT: rendering a new visible org-name header is a behaviour/visible-content
  change, not aesthetic-token polish, and no failing test demands it. Out of this MR's
  behaviour-preserving remit.
- **MR-4 — remove the breadcrumb's interim Query-Engines affordance** "once query-engines
  gets a permanent home." LEFT: that home doesn't exist yet; removing the affordance is a
  navigation/behaviour change, not polish.
- **MR-7 — surface the fridge toolbar even in the empty-pipeline state** (archived-only
  project edge). LEFT: changes empty-state render logic = behaviour change with its own
  empty-state tests; out of a behaviour-preserving refactor. Recommend a small dedicated
  story.

---

## 5. Remaining (lower-traffic / opportunistic) — accepted interim

The token layer is additive: un-migrated components simply don't reskin (acceptable per
path-forward §4.3 / open-question 8). After MR-8, the high-traffic data-grid + detail +
chat + query-engine chrome is fully migrated. Remaining opportunistic items (NOT
blocking; recommended as a future light pass):
- **`tailwind.config.js` fixed theme colours** (`surface-*`, `primary`, `accent-*`,
  `semantic-*`) still exist and are consumed by any component not yet migrated. Migrated
  components no longer depend on them for dark-awareness. A future pass can either remap
  these to the CSS variables (wide blast radius — needs its own review) or migrate the
  remaining consumers module-by-module.
- Any lower-traffic CSS module not in the straggler set that still uses Tailwind colour
  utilities (e.g. small list/empty-state components) — reskin opportunistically.
- Assistant comic-halftone / Ben-Day / Baloo flourish — token/CSS visual nicety.

---

## 6. UI-1 (SSR-ingress suite) — LEFT SKIPPED (with updated rationale)

`tests/acceptance/pipeline-ui-design-tokens/` was inspected. Status: **left skipped,
untouched.** New evidence + decision:
- The **SSR asset-hash 404 root cause is now FIXED in the committed tree** — the
  `frontend/BUILD.bazel` `ssr_dist` genrule staging-dir bug (`rm -rf ../$$TMPDIR/app`,
  line 433; the resolution recorded in the `resume-ssr-build-and-demo` session note). So
  the original blocker no longer applies.
- HOWEVER, un-skipping is still **out of scope for this frontend-only polish MR**:
  1. The two suite tests are **unimplemented stubs** that `raise AssertionError("Not yet
     implemented — deferred behind SSR blocker (UI-1)")`. Removing the module-level skip
     would turn them RED. Making them green requires *implementing* the
     httpx-through-reverse-proxy assertions.
  2. They are `@requires_external` — they need the **full running compose stack**
     (reverse-proxy → web-ssr, plus WorkOS/MinIO for boot). No stack is running in this
     headless worktree, and the MQ gate does not run acceptance suites (CLAUDE.md:
     acceptance suites run locally/by a human, not in the queue).
  3. Fixing/standing-up the SSR build is explicitly out of MR-8 scope, and UI-1 must not
     block this MR.
- **Recommendation:** file a small dedicated follow-up (now unblocked) to implement the
  two ingress assertions and un-skip UI-1 against a running stack. Did **not** edit the
  suite (keeps this MR strictly frontend-only, so `--auto` routes cleanly to `--ui`).

---

## 7. Playwright visual/contrast pass — DONE (best-effort, token-harness level)

No live app stack is running and standing up the authenticated full app is out of scope.
Best-effort pass executed instead: installed the Chrome channel, served a static harness
that imports the **real `frontend/app/theme/tokens.css`** and renders representative
token-driven markup (card + ink/muted text + primary/danger buttons + categorical type
chips + grid dividers + layer swatches), screenshotted in **light** and **`.dark`** in
real Chromium (which — unlike happy-dom — DOES apply CSS).

**Result: PASS.** Light renders the Neobrutalist skin (paper bg, white cards, hard ink
borders + offset shadows, electric layer swatches). Dark renders Solarized (deep-teal bg,
base02 cards, soft gray borders/shadows). Critically, the **dark muted secondary text is
clearly legible** — the gray-on-gray bug is visibly resolved — and every token pair
(primary/danger buttons, type chips, layer accents, borders) shows good contrast,
confirming the §2 WCAG math. Harness + screenshots were discarded (nothing committed).

**Caveat / recommended manual follow-up:** this validates the **token palette** in a real
browser, not the full assembled app under real data/auth. A full light/dark E2E sweep of
the running app (once a stack is up) remains a recommended manual check — the same stack
that would unblock UI-1 (§6).

---

## 8. Out of scope (NOT done — by instruction)
- `nw-finalize` / archival to `docs/evolution/` — NOT run (deliberate separate step;
  deferred (c) items UI-5/6/7/8 still outstanding).
- backend/, ui-state wire, deferred (c) backend work (UI-5 audit feed, UI-6 view/report
  preview, UI-7 upload history, UI-8 org retention window) — untouched.
- No aesthetic switcher / no new aesthetics beyond the locked Neobrutalist-light /
  Solarized-dark pair.

---

## 9. Gate
- Per-pass: relevant vitest green before each atomic commit.
- Pre-submit: full `cd frontend && npx vitest run` green; `./tools/test/test.sh --auto`
  (frontend touch → `--ui`) confirmed. `tools/check_workspace_consistency.py` not needed
  (no `package.json` touched). See the final MR summary for results + MQ id.
