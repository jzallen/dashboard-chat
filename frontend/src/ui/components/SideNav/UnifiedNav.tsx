import {
  ChatBubbleLeftRightIcon,
  FolderIcon,
  PlusIcon,
  ServerIcon,
} from "@heroicons/react/24/outline";
import { type KeyboardEvent, useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { Session } from "@/dataCatalog";

import { formatRelativeTime } from "../../../lib/ui/utils/formatRelativeTime";
import { useChatContext } from "../../context/ChatContext";
import { useSessions } from "../../hooks/useSessions";
import { useUpdateSession } from "../../hooks/useUpdateSession";
import styles from "./SideNav.module.css";

interface UnifiedNavProps {
  orgId: string | null;
  collapsed: boolean;
  projectId?: string | null;
}

/** Unified navigation. Always shows: New Session, Projects, Chats, Recent Sessions (from backend API). */
export function UnifiedNav({ orgId, collapsed, projectId }: UnifiedNavProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { resetSession } = useChatContext();

  // Fetch recent sessions from backend API
  const { data: sessionPages } = useSessions(projectId ?? undefined);
  const recentSessions: Session[] =
    sessionPages?.pages.flatMap((page) => page.data).slice(0, 5) ?? [];

  const updateSession = useUpdateSession(projectId ?? "");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const isChatActive = pathname === "/" || pathname.startsWith("/chat");
  const isProjectsActive = pathname.startsWith("/projects");
  const isQueryEnginesActive = pathname.startsWith("/query-engines");
  const isSessionsActive = pathname === "/sessions";

  const handleNewSession = useCallback(() => {
    resetSession();
    navigate("/");
  }, [navigate, resetSession]);

  return (
    <div data-testid="unified-nav">
      {/* New Session button */}
      <button
        className={`${styles.navItem} ${isChatActive ? styles.navItemActive : ""}`}
        onClick={handleNewSession}
        title="New Session"
        data-testid="new-session-btn"
      >
        <PlusIcon className={styles.navItemIcon} />
        {!collapsed && <span className={styles.navItemLabel}>New Session</span>}
      </button>

      {/* Projects link */}
      <button
        className={`${styles.navItem} ${isProjectsActive ? styles.navItemActive : ""}`}
        onClick={() => navigate("/projects")}
        title="Projects"
        data-testid="nav-projects"
      >
        <FolderIcon className={styles.navItemIcon} />
        {!collapsed && <span className={styles.navItemLabel}>Projects</span>}
      </button>

      {/* Query Engines link */}
      <button
        className={`${styles.navItem} ${isQueryEnginesActive ? styles.navItemActive : ""}`}
        onClick={() => navigate("/query-engines")}
        title="Query Engines"
        data-testid="nav-query-engines"
      >
        <ServerIcon className={styles.navItemIcon} />
        {!collapsed && <span className={styles.navItemLabel}>Query Engines</span>}
      </button>

      {/* All Chats link */}
      <button
        className={`${styles.navItem} ${isSessionsActive ? styles.navItemActive : ""}`}
        onClick={() => navigate("/sessions")}
        title="All Chats"
        data-testid="nav-sessions"
      >
        <ChatBubbleLeftRightIcon className={styles.navItemIcon} />
        {!collapsed && <span className={styles.navItemLabel}>All Chats</span>}
      </button>

      {/* Recent Sessions from backend API */}
      {!collapsed && recentSessions.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Recent</div>
          {recentSessions.map((session) => {
            const displayText = session.title || "New session";
            const isActive = pathname === `/chat/${session.id}`;

            if (editingId === session.id) {
              return (
                <div key={session.id} className={styles.navItem}>
                  <input
                    className={styles.navItemLabel}
                    style={{ border: "1px solid #93c5fd", borderRadius: 4, padding: "0 4px", width: "100%" }}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter" && editTitle.trim()) {
                        updateSession.mutate({
                          sessionId: session.id,
                          title: editTitle.trim(),
                        });
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => setEditingId(null)}
                    autoFocus
                    data-testid={`edit-recent-${session.id}`}
                  />
                </div>
              );
            }

            return (
              <button
                key={session.id}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                onClick={() => navigate(`/chat/${session.id}`)}
                onDoubleClick={() => {
                  setEditingId(session.id);
                  setEditTitle(displayText);
                }}
                title={displayText}
                data-testid={`recent-session-${session.id}`}
              >
                <span className={styles.navItemLabel}>
                  {displayText.length > 40 ? `${displayText.slice(0, 37)}...` : displayText}
                </span>
                {session.last_active_at && (
                  <span className={styles.navItemCount}>
                    {formatRelativeTime(session.last_active_at)}
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
