/**
 * A centered confirm/cancel dialog with a scrim, an icon medallion, a title, and
 * a free-form body. The single home for the "are you sure?" pattern so callers
 * (archive a source, restore from cold storage, rename a machine name) share one
 * lifecycle and look instead of hand-rolling their own. Purely presentational:
 * the caller owns the open/closed state and both handlers.
 *
 * `tone` selects the confirm button's emphasis — `cold` for the freeze/thaw
 * flows, `primary` otherwise.
 */
import { type ReactNode } from "react";

import styles from "../primitives.module.css";
import { Icon, type IconName } from "./Icon";

export function ConfirmDialog({
  icon,
  title,
  body,
  confirmLabel,
  confirmIcon,
  tone = "primary",
  onCancel,
  onConfirm,
}: {
  icon: IconName;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  confirmIcon?: IconName;
  tone?: "primary" | "cold";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="up-scrim" style={{ zIndex: 46 }} onClick={onCancel} />
      <div className={styles.confirmDialog} role="dialog">
        <div className={styles.confirmMedallion}>
          <Icon name={icon} size={24} />
        </div>
        <div className={styles.confirmTitle}>{title}</div>
        <div className={styles.confirmBody}>{body}</div>
        <div className={styles.confirmActions}>
          <button className="btn sq" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn sq ${tone === "cold" ? "cold-btn" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmIcon && <Icon name={confirmIcon} size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
