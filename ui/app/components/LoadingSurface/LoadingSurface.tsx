/* A full-screen indeterminate loading surface, used for the onboarding/session
   waits ("Checking your session…", "Setting up your workspace…", "Entering the
   app…"). The bar matches the upload flow's progress bar (Upload.module.css) so
   every "working…" moment in the app reads the same. The message is rendered as
   plain text so callers/tests can query it directly. */
import { useTheme } from "../AppShell";
import styles from "./LoadingSurface.module.css";

export function LoadingSurface({ message }: { message: string }) {
  // This surface is rendered at flow boundaries that live OUTSIDE the app-shell's
  // themed wrapper — the onboarding gate's "Checking your session…" and the
  // /onboarding route's waits. Without a `.app theme-neobrutalist` ancestor every
  // token falls back to the soft base theme, so the bar reads differently from
  // the rest of login/onboarding. Carry the shared rootClassName itself (the
  // themeFrame neutralises only `.app`'s viewport layout — see the CSS) so the
  // surface is identical wherever it mounts.
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
