/* Shared bits for the lineage views: the AI-edit chip. */
import { Icon } from "../primitives";
import styles from "./lineageCanvas.module.css";

/** Sparkle chip showing an AI-edit count, with an optional trailing label. */
export function AiEditChip({ count, label, style }) {
  return (
    <span className={styles.aiChip} style={style}>
      <Icon name="sparkle" />
      {count}
      {label ? ` ${label}` : ""}
    </span>
  );
}
