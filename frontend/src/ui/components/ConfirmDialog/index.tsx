// ConfirmDialog — generic confirm/cancel dialog (MR-7).
//
// Reuses the ActivityCheckModal overlay / Esc / focus pattern. Used by the snowflake
// "move to cold storage" action (and reusable for other destructive confirmations).
// Returns null while closed. testids derive from `testIdBase` (e.g. base "archive" →
// "archive-confirm-dialog" / "archive-confirm" / "archive-cancel"). Consumes MR-1 tokens;
// dark mode via the orthogonal `.dark` root class.
import { useEffect, useRef } from "react";

import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** testid prefix; defaults to "confirm" → "confirm-confirm-dialog" etc. */
  testIdBase?: string;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  testIdBase = "confirm",
}: ConfirmDialogProps): JSX.Element | null {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className={styles.overlay} onKeyDown={handleKeyDown}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={`${testIdBase}-confirm-dialog`}
      >
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            data-testid={`${testIdBase}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={styles.confirmButton}
            data-testid={`${testIdBase}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
