/* A single chat transcript row: the role-aligned message wrapper and its
   rendered prose bubble. */
import styles from "./Chat.module.css";
import type { TurnMessage } from "./useChatTurn";

/**
 * Minimal, self-contained markdown → HTML for chat bubbles, rendered via
 * `dangerouslySetInnerHTML` at the call site.
 *
 * SECURITY — the escape MUST come first. HTML metacharacters (`& < >`) are
 * neutralised before the bold/code regexes run, so no user-supplied text can
 * inject markup and no substitution the regexes emit can reopen an injection
 * vector. Reorder these steps and the output is no longer safe to inject; keep
 * escape-first, or replace this with a vetted markdown + sanitizer pipeline.
 */
export function fmt(text: string): string {
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

export function ChatBubble({ m }: { m: TurnMessage }) {
  return (
    <div
      className={`${styles.message} ${m.role === "user" ? styles.user : styles.bot}`}
    >
      <div
        className={styles.bubble}
        dangerouslySetInnerHTML={{ __html: fmt(m.text) }}
      />
    </div>
  );
}
