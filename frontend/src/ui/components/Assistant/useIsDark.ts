// useIsDark — reactive dark-mode flag for the Assistant render branch (MR-4).
//
// The locked design renders the assistant as a glass/comic overlay in light mode and
// a docked TUI terminal in dark mode (path-forward §2.4 / §9). That is a STRUCTURAL
// branch, not just a CSS reskin, so the assistant needs a *reactive* dark flag.
//
// Two independent `useTheme()` instances do NOT share state (each seeds its own
// useState from localStorage), so the assistant cannot react to the org-sheet
// ThemeToggle by calling useTheme() a second time. Instead this hook reads the
// AUTHORITATIVE applied flag — the `dark` class that theme.ts/applyThemeClass writes
// onto <html> (MR-1) — via useSyncExternalStore + a MutationObserver, so flipping
// dark mode anywhere in the app flips the assistant's render branch (DWD-M4-4).
// SSR-safe: getServerSnapshot returns light (the SSR default).
import { useSyncExternalStore } from "react";

import { DARK_CLASS } from "../../../../app/theme/theme";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(DARK_CLASS);
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
