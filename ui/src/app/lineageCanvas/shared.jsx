/* Shared bits for the lineage views: a classNames helper and the AI-edit chip. */
import { Icon } from "../primitives";

/** Join class-name parts, dropping falsy ones, into a single space-separated string. */
export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/** Sparkle chip showing an AI-edit count, with an optional trailing label. */
export function AiEditChip({ count, label, style }) {
  return (
    <span className="ai-chip" style={style}>
      <Icon name="sparkle" />
      {count}
      {label ? ` ${label}` : ""}
    </span>
  );
}
