// AssistantChangesPanel — model-detail "Assistant changes" audit panel (MR-5).
//
// Presentational: renders the assistant tool-call audit entries for the current
// model (derived from the live chat session via deriveAssistantChanges) or an
// explicit empty-state. Pure over its props. Consumes MR-1 tokens.
import type { AssistantChange } from "../../../core/chat/assistantChanges";
import styles from "./ModelDetail.module.css";

export interface AssistantChangesPanelProps {
  changes: AssistantChange[];
}

export function AssistantChangesPanel({
  changes,
}: AssistantChangesPanelProps): JSX.Element {
  return (
    <section className={styles.section} data-testid="assistant-changes-panel">
      <div className={styles.sectionTitle}>Assistant changes</div>
      {changes.length === 0 ? (
        <div data-testid="assistant-changes-empty" className={styles.emptyState}>
          No assistant changes recorded for this model yet.
        </div>
      ) : (
        <ul className={styles.changeList}>
          {changes.map((change, index) => (
            <li
              key={change.id}
              data-testid={`assistant-change-${index}`}
              className={styles.change}
            >
              <span className={styles.changeTool}>{change.tool}</span>
              {change.summary && (
                <span className={styles.changeSummary}>{change.summary}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
