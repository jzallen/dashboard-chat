// AssistantControls — overlay-internal session controls (MR-4).
//
// These are the controls MR-3 deferred out of the breadcrumb (DWD-M3-4 → DWD-M4-6):
// New Session (+) resets the chat session and returns to the index; history (clock)
// navigates to All Chats (/sessions); recent-chat chips come from the existing
// useSessions hook (the same listSessions port SessionList / UnifiedNav use) and
// deep-link to /chat/:id. The ui-state wire is NOT touched — recents are read from
// the dataCatalog sessions hook, scoped to the active (route or default) project.
import { useNavigate, useParams } from "react-router";

import type { Project } from "@/dataCatalog";

import { useChatContext } from "../../context/ChatContext";
import { useSessions } from "../../hooks/useSessions";
import styles from "./Assistant.module.css";

export interface AssistantControlsProps {
  projects: Project[] | null;
}

const MAX_RECENTS = 5;

export function AssistantControls({ projects }: AssistantControlsProps): JSX.Element {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const { resetSession } = useChatContext();

  // Recents are scoped to the active project — the route's project when present,
  // else the org's default (first) project (the same fallback the shell uses).
  const projectId = routeProjectId ?? projects?.[0]?.id;
  const { data: sessionPages } = useSessions(projectId);
  const recents = (sessionPages?.pages.flatMap((page) => page.data) ?? []).slice(
    0,
    MAX_RECENTS,
  );

  const newSession = () => {
    resetSession();
    navigate("/");
  };

  return (
    <>
      <div className={styles.controls}>
        <button
          type="button"
          data-testid="assistant-new-session"
          className={styles.controlBtn}
          aria-label="New session"
          onClick={newSession}
        >
          + New
        </button>
        <button
          type="button"
          data-testid="assistant-history"
          className={styles.controlBtn}
          aria-label="All chats"
          onClick={() => navigate("/sessions")}
        >
          History
        </button>
      </div>
      {recents.length > 0 && (
        <div className={styles.recents}>
          {recents.map((session) => (
            <button
              key={session.id}
              type="button"
              data-testid={`assistant-recent-${session.id}`}
              className={styles.chip}
              title={session.title ?? "New session"}
              onClick={() => navigate(`/chat/${session.id}`)}
            >
              {session.title || "New session"}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default AssistantControls;
