/* Cold-storage viewer: retired sources awaiting auto-deletion, each restorable
   until its retention ends. */
import { useState } from "react";

import type { ColdStorageItem } from "../../catalog";
import { Icon, type IconName } from "../primitives";
import styles from "./ColdStorage.module.css";

const DAY_MS = 86400000;
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// Empty-state flavor — one random "leftover in the fridge" per open.
const FOODS: { icon: IconName; line: string }[] = [
  { icon: "donut", line: "Nothing in here but a day-old donut" },
  { icon: "egg", line: "Nothing in here but a single egg" },
  { icon: "carrot", line: "Nothing in here but a lonely carrot" },
  { icon: "icecream", line: "Nothing in here but melting ice cream" },
  { icon: "cookie", line: "Nothing in here but one last cookie" },
  { icon: "pizza", line: "Nothing in here but a cold slice of pizza" },
];

export function ColdStorageModal({
  items,
  onRestore,
  onClose,
}: {
  items: ColdStorageItem[];
  onRestore: (id: string) => void;
  onClose: () => void;
}) {
  const [food] = useState(
    () => FOODS[Math.floor(Math.random() * FOODS.length)],
  );
  return (
    <>
      <div className="up-scrim" onClick={onClose} />
      <div
        className="up-modal cold-modal"
        role="dialog"
        aria-label="Cold storage"
      >
        <div className="up-head">
          <span className="up-mark cold-mark">
            <Icon name="fridge" size={16} />
          </span>
          <div className="up-htext">
            <div className="up-title">Cold storage</div>
            <div className="up-sub">
              Retired sources · auto-deleted after retention
            </div>
          </div>
          <button className="up-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="up-body">
          {items.length === 0 && (
            <div className={styles.coldEmpty}>
              <div className="dz-ic food">
                <Icon name={food.icon} size={28} />
              </div>
              <div className="dz-title">{food.line}</div>
              <div className="dz-sub">
                Retire a source from its upload window and it'll wait here,
                restorable, until its retention ends.
              </div>
            </div>
          )}
          {items.map((it) => {
            const end = it.retiredAt + it.retentionDays * DAY_MS;
            const daysLeft = Math.max(
              0,
              Math.ceil((end - Date.now()) / DAY_MS),
            );
            return (
              <div className={styles.coldRow} key={it.id}>
                <span className={styles.coldIc}>
                  <Icon name="database" size={15} />
                </span>
                <div className={styles.coldMain}>
                  <div className={styles.coldName}>{it.name}</div>
                  <div className={styles.coldMeta}>
                    <span>Retired {fmtDate(it.retiredAt)}</span>
                    <span className={styles.cdot}>·</span>
                    <span>Deletes {fmtDate(end)}</span>
                    <span className={styles.cdot}>·</span>
                    <span>
                      {(it.files || []).length} file
                      {(it.files || []).length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div
                  className={`${styles.coldLeft}${daysLeft <= 7 ? " " + styles.soon : ""}`}
                >
                  <b>{daysLeft}</b>
                  <span>days left</span>
                </div>
                <button className="btn sq" onClick={() => onRestore(it.id)}>
                  <Icon name="refresh" size={14} />
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
