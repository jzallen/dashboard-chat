import { useEffect, useState } from "react";
import { Link,useParams } from "react-router-dom";

import { type ChatSession, type ChatTurn,getSession } from "@/api/sessions";

import styles from "./SessionViewer.module.css";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatJson(value: unknown): string {
  try {
    if (typeof value === "string") {
      return JSON.stringify(JSON.parse(value), null, 2);
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function TurnCard({ turn, index }: { turn: ChatTurn; index: number }) {
  return (
    <div className={styles.turnCard}>
      <div className={styles.turnHeader}>
        Turn {index + 1} &middot; {formatDate(turn.created_at)}
      </div>

      <div className={styles.messageBlock}>
        <div className={styles.messageLabel}>User</div>
        <div className={styles.userMessage}>{turn.user_message}</div>

        {turn.assistant_content && (
          <>
            <div className={styles.messageLabel} style={{ marginTop: 12 }}>
              Assistant
            </div>
            <div className={styles.assistantMessage}>
              {turn.assistant_content}
            </div>
          </>
        )}
      </div>

      {turn.tool_calls && turn.tool_calls.length > 0 && (
        <details className={styles.detailsSection}>
          <summary>
            Tool Calls ({turn.tool_calls.length})
          </summary>
          <div className={styles.detailsContent}>
            {turn.tool_calls.map((tc, i) => (
              <div key={i} className={styles.toolCallItem}>
                <div className={styles.toolCallName}>
                  {tc.function.name}
                </div>
                <pre className={styles.preBlock}>
                  {formatJson(tc.function.arguments)}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {turn.tool_results && turn.tool_results.length > 0 && (
        <details className={styles.detailsSection}>
          <summary>
            Tool Results ({turn.tool_results.length})
          </summary>
          <div className={styles.detailsContent}>
            {turn.tool_results.map((tr, i) => (
              <pre key={i} className={styles.preBlock}>
                {formatJson(tr.result)}
              </pre>
            ))}
          </div>
        </details>
      )}

      <details className={styles.detailsSection}>
        <summary>Debug</summary>
        <div className={styles.detailsContent}>
          <div className={styles.messageLabel}>System Prompt</div>
          <pre className={styles.preBlock}>{turn.system_prompt}</pre>

          {turn.tool_definitions && turn.tool_definitions.length > 0 && (
            <>
              <div className={styles.messageLabel} style={{ marginTop: 8 }}>
                Tool Definitions
              </div>
              <pre className={styles.preBlock}>
                {formatJson(turn.tool_definitions)}
              </pre>
            </>
          )}

          <div className={styles.messageLabel} style={{ marginTop: 8 }}>
            Table Schema
          </div>
          <pre className={styles.preBlock}>
            {formatJson(turn.table_schema)}
          </pre>
        </div>
      </details>
    </div>
  );
}

/** Displays a read-only view of a past chat session with its turns and tool calls. */
export function SessionViewer() {
  const { projectId, datasetId, sessionId } = useParams<{ projectId: string; datasetId: string; sessionId: string }>();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className={styles.container}><div className={styles.loading}>Loading session...</div></div>;
  }

  if (error) {
    return <div className={styles.container}><div className={styles.error}>{error}</div></div>;
  }

  if (!session) {
    return <div className={styles.container}><div className={styles.emptyState}>Session not found</div></div>;
  }

  const backTo = projectId && datasetId
    ? `/projects/${projectId}/datasets/${datasetId}/sessions`
    : "/projects";

  return (
    <div className={styles.container}>
      <Link to={backTo} className={styles.backLink}>
        &larr; Back to sessions
      </Link>

      <div className={styles.sessionHeader}>
        <div className={styles.sessionTitle}>{session.id}</div>
        <div className={styles.sessionMeta}>
          <span>Created: {formatDate(session.created_at)}</span>
          {session.dataset_id && <span>Dataset: {session.dataset_id}</span>}
          <span>{session.turns.length} turn{session.turns.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className={styles.turnList}>
        {session.turns.map((turn, i) => (
          <TurnCard key={turn.id} turn={turn} index={i} />
        ))}
      </div>
    </div>
  );
}
