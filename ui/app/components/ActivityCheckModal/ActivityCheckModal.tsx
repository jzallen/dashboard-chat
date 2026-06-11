/* "Are you still there?" inactivity modal — ported from frontend/src/ui/
   components/ActivityCheckModal. Opens when the idle tracker passes its
   threshold; runs a grace timer (MODAL_TIMEOUT_MS) and auto-logs-out if the user
   doesn't confirm. Continue dismisses + restamps activity; Log Out leaves now. */
import { useCallback, useEffect, useRef } from "react";

import styles from "./ActivityCheckModal.module.css";

const MODAL_TIMEOUT_MS = 10 * 60 * 1000; // grace before auto-logout

interface ActivityCheckModalProps {
  isOpen: boolean;
  onContinue: () => void;
  onLogout: () => void;
}

export function ActivityCheckModal({
  isOpen,
  onContinue,
  onLogout,
}: ActivityCheckModalProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus the Continue button on open.
  useEffect(() => {
    if (isOpen) continueRef.current?.focus();
  }, [isOpen]);

  // Grace timer → auto-logout if the user never confirms.
  useEffect(() => {
    if (!isOpen) return;
    const timerId = setTimeout(onLogout, MODAL_TIMEOUT_MS);
    return () => clearTimeout(timerId);
  }, [isOpen, onLogout]);

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
          Your session will expire soon due to inactivity. Click Continue to keep
          working.
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
