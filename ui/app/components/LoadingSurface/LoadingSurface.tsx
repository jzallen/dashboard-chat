/* A full-screen indeterminate loading surface, used for the onboarding/session
   waits ("Checking your session…", "Setting up your workspace…", "Entering the
   app…"). The bar matches the upload flow's progress bar (Upload.module.css) so
   every "working…" moment in the app reads the same. The message is rendered as
   plain text so callers/tests can query it directly. */
import styles from "./LoadingSurface.module.css";

export function LoadingSurface({ message }: { message: string }) {
  return (
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
  );
}
