/**
 * Full-screen indeterminate loading surface for onboarding/session waits
 * ("Checking your session…", "Setting up your workspace…", "Entering the
 * app…"). The bar matches the upload flow's progress bar (Upload.module.css)
 * so every "working…" moment in the app reads the same. The message is
 * rendered as plain text so callers/tests can query it directly.
 *
 * Coupling contract — ThemeProvider class-name shape: this surface renders at
 * flow boundaries that live OUTSIDE the app-shell's themed wrapper, so it
 * re-applies `rootClassName` from {@link useTheme} directly. That value is
 * currently `"app theme-neobrutalist[ dark]"` (see ThemeProvider). If
 * ThemeProvider ever changes the root class-name format, this component must
 * be updated in lockstep — a silent style regression is the failure mode, not
 * a runtime error.
 */
import { useTheme } from "../AppShell";
import styles from "./LoadingSurface.module.css";

export function LoadingSurface({ message }: { message: string }) {
  const { rootClassName } = useTheme();
  return (
    <div className={`${rootClassName} ${styles.themeFrame}`}>
      <main className={styles.surface}>
        <div className={styles.card}>
          <p className={styles.status} aria-live="polite">
            {message}
          </p>
          <div
            className={styles.track}
            role="progressbar"
            aria-label={message}
            aria-busy="true"
          >
            <div className={styles.fill} />
          </div>
        </div>
      </main>
    </div>
  );
}
