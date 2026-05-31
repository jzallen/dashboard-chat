// Dark-mode toggle — RED scaffold (created by DISTILL, MR-1).
//
// The org-view "Appearance" control. The only user-facing theme control in the
// product (no aesthetic switcher — path-forward §9). Renders a switch that flips
// light↔dark via useTheme(); the hook owns persistence + root-class application.
import { useTheme } from "./theme";

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const dark = mode === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      data-testid="dark-mode-toggle"
      onClick={toggle}
    >
      {dark ? "Dark" : "Light"}
    </button>
  );
}

export default ThemeToggle;
