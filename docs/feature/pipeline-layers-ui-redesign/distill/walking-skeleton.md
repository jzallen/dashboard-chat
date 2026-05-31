# Walking Skeleton — pipeline-layers-ui-redesign / MR-1

> Notes only. The executable SSOT is `frontend/app/theme/theme.test.tsx`
> (vitest) + `tests/acceptance/pipeline-ui-design-tokens/` (deferred ingress).

## The thin slice
Prove the **design-token + dark-mode mechanism end-to-end** on one surface,
without building any feature on top of it: a first-time load applies the
Neobrutalist-light default before paint (no flash), a toggle flips to
Solarized-dark and persists, and a reload re-applies the stored preference.

## Walking-skeleton scenario (AC1)
`theme.test.tsx > "AC1 first-paint default theme (walking skeleton)"` —
**`@walking_skeleton @real-io`**. Given no stored preference, when the
pre-hydration init runs against the real `documentElement`, then the root carries
`theme-neobrutalist` and not `dark`. This is the first-paint no-flash contract.

## Supporting scenarios
| AC | Scenario | Driving port | Kind |
|----|----------|--------------|------|
| AC1 | first-paint default = Neobrutalist light | SSR pre-hydration init | WS / happy |
| AC1b | inline init-script seam reads the pref key | Layout `<head>` script | happy |
| AC3 | persisted dark applied before hydration | SSR pre-hydration init | happy |
| AC4 | corrupt/missing pref → light, no error | init / `readStoredMode` | **edge** |
| AC2 | toggle flips root + persists, both ways | org-view `ThemeToggle` | happy |
| — | `readStoredMode` default / valid | preference primitive | happy + edge |
| — | `applyThemeClass` add/remove dark | class primitive | happy + edge |

Error/edge ≈ 3/9 (~33%); AC4 is the key failure path for a presentation slice
with a single local resource.

## Adapter coverage
| Adapter (driven) | @real-io scenario | Covered by |
|------------------|-------------------|-----------|
| `localStorage` (preference) | YES | AC2/AC3/AC4 (real happy-dom localStorage) |
| `document.documentElement` (root class) | YES | AC1/AC2/AC3 (real root mutation) |

Driving adapter (SSR HTTP ingress): authored as deferred `@adapter_integration`
(`tests/acceptance/pipeline-ui-design-tokens/`), gated to vitest for now — DWD-2.

## RED→GREEN handoff (DELIVER)
- Scaffolds: `frontend/app/theme/{theme.ts, ThemeToggle.tsx, tokens.css}` —
  all `__SCAFFOLD__`, bodies throw the RED marker. Verified RED (9/9 scaffold
  failures, zero BROKEN).
- DELIVER implements `readStoredMode`, `applyThemeClass`, `initThemeFromStorage`,
  `themeInitScript`, `useTheme`, the real token values in `tokens.css`, wires the
  init script into `Layout` (`root.tsx`) + the token sheet into the app, refactors
  the shell frame + a breadcrumb stub to consume tokens, and mounts `ThemeToggle`
  in the org-view appearance panel. Done when all 9 vitest cases are GREEN and
  `grep -r __SCAFFOLD__ frontend/app/theme` is empty.

## Run
```bash
cd frontend && npx vitest run app/theme        # the walking skeleton + ACs (RED now)
```
