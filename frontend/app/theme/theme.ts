// Design-token theme layer (MR-1).
//
// Scope (docs/feature/pipeline-layers-ui-redesign/path-forward.md §5 MR-1, §9):
//   - ONE production aesthetic — Neobrutalist (light). NO multi-aesthetic switcher.
//   - A `.dark` root class carries the Solarized-dark palette, orthogonal to the
//     aesthetic class (it stacks on it).
//   - The light/dark preference persists in localStorage with an SSR-safe default
//     (light), applied BEFORE hydration via `themeInitScript()` so there is no
//     flash of the wrong theme on first paint.
//   - Token *values* live in ./tokens.css (CSS custom properties). This module
//     only owns the class/preference mechanism — the no-flash contract.
import { useCallback, useEffect, useState } from "react";

/** The single root aesthetic class — always present on the themed root. */
export const AESTHETIC_CLASS = "theme-neobrutalist";

/** The orthogonal dark-mode class, stacked on the aesthetic class. */
export const DARK_CLASS = "dark";

/** localStorage key for the persisted light/dark preference. */
export const THEME_STORAGE_KEY = "dc-theme";

export type ThemeMode = "light" | "dark";

/** SSR-safe default: Neobrutalist light. First paint renders this when no
 *  preference is stored, guaranteeing no flash. */
export const DEFAULT_MODE: ThemeMode = "light";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

/** Read the persisted mode, falling back to DEFAULT_MODE on a missing or
 *  unrecognised (corrupt) value. Never throws. */
export function readStoredMode(storage?: Pick<Storage, "getItem">): ThemeMode {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Apply the theme classes to a root element for the given mode: the aesthetic
 *  class is always present; the dark class is added for "dark" and removed for
 *  "light". */
export function applyThemeClass(
  root: { classList: DOMTokenList },
  mode: ThemeMode,
): void {
  root.classList.add(AESTHETIC_CLASS);
  if (mode === "dark") {
    root.classList.add(DARK_CLASS);
    return;
  }
  root.classList.remove(DARK_CLASS);
}

/** The pre-hydration init logic: read the stored preference and apply the theme
 *  class to the given root BEFORE first paint — the no-flash guarantee. Pure and
 *  directly callable (this is what the walking-skeleton test exercises); falls
 *  back to the light default on missing/corrupt input. */
export function initThemeFromStorage(
  root: { classList: DOMTokenList },
  storage?: Pick<Storage, "getItem">,
): void {
  try {
    applyThemeClass(root, readStoredMode(storage));
  } catch {
    /* never let theme init break first paint */
  }
}

/** The inline <head> script body (as a string) the Layout injects so the browser
 *  runs the theme init before first paint. A serialized call to the pure init
 *  logic above — NOT an interpolation of any runtime value, so it carries no
 *  injection surface. */
export function themeInitScript(): string {
  return `(function(){
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var aesthetic = ${JSON.stringify(AESTHETIC_CLASS)};
    var darkClass = ${JSON.stringify(DARK_CLASS)};
    var stored = window.localStorage.getItem(key);
    var root = document.documentElement;
    root.classList.add(aesthetic);
    if (stored === "dark") { root.classList.add(darkClass); }
    else { root.classList.remove(darkClass); }
  } catch (e) {}
})();`;
}

export interface ThemeController {
  mode: ThemeMode;
  /** Flip light↔dark: updates the root class and persists to localStorage. */
  toggle: () => void;
}

/** Client hook backing the org-view appearance toggle. Seeds from the stored
 *  preference, applies the class, and persists on change. */
export function useTheme(): ThemeController {
  const [mode, setMode] = useState<ThemeMode>(() =>
    readStoredMode(typeof window === "undefined" ? undefined : window.localStorage),
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    applyThemeClass(document.documentElement, mode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* persistence is best-effort */
    }
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { mode, toggle };
}
