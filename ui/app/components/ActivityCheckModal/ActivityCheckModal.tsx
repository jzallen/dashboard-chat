/* "Are you still there?" inactivity modal — ported from frontend/src/ui/
   components/ActivityCheckModal. Opens when the idle tracker passes its
   threshold; runs a grace timer (MODAL_TIMEOUT_MS) and auto-logs-out if the user
   doesn't confirm. Continue dismisses + restamps activity; Log Out leaves now. */
import { useCallback, useEffect, useRef } from "react";

import styles from "./ActivityCheckModal.module.css";

/** Default grace before auto-logout. Overridable via {@link ActivityCheckModalProps.timeoutMs}
 *  so tests inject small values and ops can tune without a rebuild. */
export const DEFAULT_MODAL_TIMEOUT_MS = 10 * 60 * 1000;

interface ActivityCheckModalProps {
  isOpen: boolean;
  onContinue: () => void;
  onLogout: () => void;
  /** Grace window before auto-logout (default {@link DEFAULT_MODAL_TIMEOUT_MS}). */
  timeoutMs?: number;
}

export function ActivityCheckModal({
  isOpen,
  onContinue,
  onLogout,
  timeoutMs = DEFAULT_MODAL_TIMEOUT_MS,
}: ActivityCheckModalProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus the Continue button on open, and restore focus to whatever the user
  // was on when the dialog closes (a11y: focus must not be stranded on removed
  // DOM). The bespoke Tab trap below still keeps focus inside while open.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    continueRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [isOpen]);

  // Grace timer → auto-logout if the user never confirms.
  useEffect(() => {
    if (!isOpen) return;
    const timerId = setTimeout(onLogout, timeoutMs);
    return () => clearTimeout(timerId);
  }, [isOpen, onLogout, timeoutMs]);

  // Keep Tab focus within the dialog.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      data-testid="activity-check-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-check-title"
      aria-describedby="activity-check-description"
      onKeyDown={handleKeyDown}
      ref={modalRef}
    >
      <div className={styles.card}>
        <h2 id="activity-check-title" className={styles.title}>
          Are you still there?
        </h2>
        <p id="activity-check-description" className={styles.description}>
          Your session will expire soon due to inactivity. Click Continue to
          keep working.
        </p>
        <div className={styles.actions}>
          <button
            ref={continueRef}
            className="btn primary"
            data-testid="activity-check-confirm"
            onClick={onContinue}
            type="button"
          >
            Continue
          </button>
          <button className="btn" onClick={onLogout} type="button">
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
