// useIsDark — reactive dark-mode flag for the Assistant render branch (MR-4).
//
// RED scaffold (created by DISTILL). The locked design renders the assistant as a
// glass/comic overlay in light mode and a docked TUI terminal in dark mode
// (path-forward §2.4 / §9). That is a STRUCTURAL branch, not just a CSS reskin, so
// the assistant needs a *reactive* dark flag.
//
// Two independent `useTheme()` instances do NOT share state (each seeds its own
// useState from localStorage), so the assistant cannot react to the org-sheet
// ThemeToggle by calling useTheme() a second time. Instead this hook reads the
// AUTHORITATIVE applied flag — the `dark` class that theme.ts/applyThemeClass
// writes onto <html> — via a MutationObserver, so flipping dark mode anywhere in
// the app flips the assistant's render branch (DWD-M4-3).
export const __SCAFFOLD__ = true;

export function useIsDark(): boolean {
  throw new Error("Not yet implemented — RED scaffold (Assistant MR-4)");
}
