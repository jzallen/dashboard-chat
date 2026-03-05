import { useEffect, useState } from "react";
import { Link,useNavigate, useParams } from "react-router-dom";

import { type ChatSession,listSessions } from "@/chat/client";

import styles from "./SessionViewer.module.css";

export function SessionList() {
  const { projectId, datasetId } = useParams<{ projectId: string; datasetId: string }>();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!datasetId) return;
    setLoading(true);
    setError(null);
    listSessions(datasetId)
      .then(setSessions)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [datasetId]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getPreview = (session: ChatSession): string => {
    if (!session.turns.length) return "(empty session)";
    const msg = session.turns[0].user_message;
    return msg.length > 80 ? msg.slice(0, 80) + "..." : msg;
  };

  return (
    <div className={styles.container}>
      <Link to={`/projects/${projectId}/datasets/${datasetId}`} className={styles.backLink}>
        &larr; Back to dataset
      </Link>

      <div className={styles.listHeader}>
        <h2 className={styles.listTitle}>Chat Sessions</h2>
      </div>

      {loading && <div className={styles.loading}>Loading sessions...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {!loading && !error && sessions.length === 0 && (
        <div className={styles.emptyState}>No sessions yet</div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <table className={styles.sessionTable}>
          <thead>
            <tr>
              <th>Session</th>
              <th>Created</th>
              <th>Turns</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr
                key={s.id}
                className={styles.sessionRow}
                onClick={() => navigate(`/projects/${projectId}/datasets/${datasetId}/sessions/${s.id}`)}
              >
                <td className={styles.sessionId}>{s.id.slice(0, 8)}</td>
                <td>{formatDate(s.created_at)}</td>
                <td>{s.turns.length}</td>
                <td className={styles.previewText}>{getPreview(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
