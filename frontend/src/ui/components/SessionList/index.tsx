import { PencilIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";

import type { Session } from "@/dataCatalog";

import { formatRelativeTime } from "../../../lib/ui/utils/formatRelativeTime";
import { useSessions } from "../../hooks/useSessions";
import { useUpdateSession } from "../../hooks/useUpdateSession";
import type { AppShellContext } from "../AppShell";
import styles from "./SessionList.module.css";

/** Org-scoped session list page backed by the backend sessions API. */
export function SessionList() {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const { projects } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  // Use route param or fall back to first project
  const projectId = routeProjectId ?? projects?.[0]?.id;

  const {
    data: sessionPages,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useSessions(projectId);

  const updateSession = useUpdateSession(projectId ?? "");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const sessions: Session[] =
    sessionPages?.pages.flatMap((page) => page.data) ?? [];

  const handleStartEdit = (session: Session) => {
    setEditingId(session.id);
    setEditTitle(session.title ?? "");
  };

  const handleConfirmEdit = (session: Session) => {
    const newTitle = editTitle.trim();
    if (newTitle) {
      updateSession.mutate({ sessionId: session.id, title: newTitle });
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
  };

  if (isLoading && sessions.length === 0) {
    return <div className={styles.loading}>Loading sessions...</div>;
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Chat Sessions</h2>

      {sessions.length === 0 ? (
        <p className={styles.empty}>
          No chat sessions yet. Start a new session from the home page.
        </p>
      ) : (
        <div className={styles.list}>
          {sessions.map((session) => {
            const displayText = session.title || "New session";

            if (editingId === session.id) {
              return (
                <div
                  key={session.id}
                  className={styles.sessionRow}
                  data-testid={`session-${session.id}`}
                >
                  <input
                    className={styles.editInput}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmEdit(session);
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                    autoFocus
                    data-testid="title-edit-input"
                  />
                </div>
              );
            }

            return (
              <div
                key={session.id}
                className={styles.sessionRow}
                onClick={() => navigate(`/chat/${session.id}`)}
                data-testid={`session-${session.id}`}
              >
                <span className={styles.sessionTitle}>{displayText}</span>
                <span className={styles.sessionOwner}>{session.owner_id}</span>
                <span className={styles.sessionTimestamp}>
                  {formatRelativeTime(session.last_active_at)}
                </span>
                <button
                  className={styles.editButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(session);
                  }}
                  title="Edit title"
                  data-testid={`edit-${session.id}`}
                >
                  <PencilIcon className={styles.editIcon} />
                </button>
              </div>
            );
          })}

          {hasNextPage && (
            <button
              className={styles.loadMoreButton}
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
