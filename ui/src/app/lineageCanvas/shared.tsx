/* Shared bits for the lineage views: the AI-edit chip. */
import type { CSSProperties } from "react";

import { Icon } from "../primitives";
import styles from "./lineageCanvas.module.css";

/** Sparkle chip showing an AI-edit count, with an optional trailing label. */
export function AiEditChip({
  count,
  label,
  style,
}: {
  count: number;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={styles.aiChip} style={style}>
      <Icon name="sparkle" />
      {count}
      {label ? ` ${label}` : ""}
    </span>
  );
}
