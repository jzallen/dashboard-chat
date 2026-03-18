import {
  ChatBubbleLeftRightIcon,
  FolderIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Channel } from "stream-chat";

import { useStreamContext } from "@/stream/StreamProvider";

import { useChatContext } from "../../context/ChatContext";
import { formatRelativeTime } from "../../../lib/ui/utils/formatRelativeTime";
import styles from "./SideNav.module.css";

interface UnifiedNavProps {
  orgId: string | null;
  collapsed: boolean;
}

/** Unified navigation replacing OrgNav/ProjectNav. Always shows: New Session, Projects, Chats, Recent Sessions. */
export function UnifiedNav({ orgId, collapsed }: UnifiedNavProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { client, isReady } = useStreamContext();
  const { resetSession } = useChatContext();
  const [recentChannels, setRecentChannels] = useState<Channel[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [localTitles, setLocalTitles] = useState<Map<string, string>>(new Map());

  const isChatActive = pathname === "/" || pathname.startsWith("/chat");
  const isProjectsActive = pathname.startsWith("/projects");
  const isSessionsActive = pathname === "/sessions";

  // Query recent sessions from Stream
  useEffect(() => {
    if (!client || !isReady || !orgId) return;

    let mounted = true;

    async function fetchRecent() {
      try {
        const channels = await client!.queryChannels(
          {
            type: "messaging" as const,
            "custom.orgId": orgId,
          },
          [{ last_message_at: -1 as const }],
          { limit: 5, watch: true },
        );
        if (mounted) setRecentChannels(channels);
      } catch (err) {
        console.error("Failed to fetch recent sessions:", err);
      }
    }

    let unsubscribe: (() => void) | undefined;

    const handleMessageNew = (event: { channel_id?: string; channel?: { id?: string } }) => {
      const eventChannelId = event.channel_id ?? event.channel?.id;
      if (!eventChannelId) return;
      setRecentChannels((prev) => {
        const idx = prev.findIndex((ch) => ch.id === eventChannelId);
        if (idx <= 0) return prev; // already at top or not found
        const updated = [...prev];
        const [moved] = updated.splice(idx, 1);
        updated.unshift(moved);
        return updated;
      });
    };

    fetchRecent().then(() => {
      if (!mounted) return;
      client!.on("message.new", handleMessageNew);
      unsubscribe = () => { client!.off("message.new", handleMessageNew); };
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [client, isReady, orgId]);

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

      {/* Recent Sessions */}
      {!collapsed && recentChannels.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Recent</div>
          {recentChannels.map((ch) => {
            const data = ch.data as Record<string, unknown> | undefined;
            const rawTitle = (data?.title as string) || null;
            const title = localTitles.get(ch.id) ?? rawTitle;
            const firstMessage = ch.state.messages?.[0]?.text;
            const displayText = title || (firstMessage ? firstMessage.slice(0, 40) : "New session");
            const isActive = pathname === `/chat/${ch.id}`;
            const lastMessageAt = ch.state.last_message_at as string | undefined;

            if (editingId === ch.id) {
              return (
                <div key={ch.id} className={styles.navItem}>
                  <input
                    className={styles.navItemLabel}
                    style={{ border: "1px solid #93c5fd", borderRadius: 4, padding: "0 4px", width: "100%" }}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter" && editTitle.trim()) {
                        const newTitle = editTitle.trim();
                        const channelId = ch.id;
                        // Optimistically update
                        setLocalTitles((prev) => new Map(prev).set(channelId, newTitle));
                        setEditingId(null);
                        // Persist (revert on error)
                        ch.updatePartial({ set: { title: newTitle } }).catch(() => {
                          setLocalTitles((prev) => {
                            const m = new Map(prev);
                            m.delete(channelId);
                            return m;
                          });
                        });
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => setEditingId(null)}
                    autoFocus
                    data-testid={`edit-recent-${ch.id}`}
                  />
                </div>
              );
            }

            return (
              <button
                key={ch.id}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                onClick={() => navigate(`/chat/${ch.id}`)}
                onDoubleClick={() => {
                  setEditingId(ch.id);
                  setEditTitle(displayText);
                }}
                title={displayText}
                data-testid={`recent-session-${ch.id}`}
              >
                <span className={styles.navItemLabel}>
                  {displayText.length > 40 ? `${displayText.slice(0, 37)}...` : displayText}
                </span>
                {lastMessageAt && (
                  <span className={styles.navItemCount}>
                    {formatRelativeTime(lastMessageAt)}
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
