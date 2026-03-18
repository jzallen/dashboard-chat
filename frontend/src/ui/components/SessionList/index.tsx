import { PencilIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { Channel } from "stream-chat";

import { useStreamContext } from "@/stream/StreamProvider";

import { useDatasetQuery } from "../../hooks/useDatasetQuery";
import { formatRelativeTime } from "../../../lib/ui/utils/formatRelativeTime";
import type { AppShellContext } from "../AppShell";
import styles from "./SessionList.module.css";

/** Resolves a dataset ID to its name via the query cache. */
function DatasetBadge({ datasetId }: { datasetId: string }) {
  const { data } = useDatasetQuery(datasetId);
  return (
    <span className={styles.datasetBadge}>{data?.name ?? datasetId}</span>
  );
}

/** Org-scoped session list page backed by Stream queryChannels. */
export function SessionList() {
  const { orgId } = useOutletContext<AppShellContext>();
  const { client, isReady } = useStreamContext();
  const navigate = useNavigate();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [localTitles, setLocalTitles] = useState<Map<string, string>>(new Map());

  const PAGE_SIZE = 30;

  const fetchChannels = useCallback(
    async (offset = 0) => {
      if (!client || !isReady || !orgId) return;
      setLoading(true);
      try {
        const result = await client.queryChannels(
          {
            type: "messaging" as const,
            "custom.orgId": orgId,
          },
          [{ last_message_at: -1 as const }],
          { limit: PAGE_SIZE, offset },
        );
        if (offset === 0) {
          setChannels(result);
        } else {
          setChannels((prev) => [...prev, ...result]);
        }
        setHasMore(result.length === PAGE_SIZE);
      } catch (err) {
        console.error("Failed to fetch sessions:", err);
      } finally {
        setLoading(false);
      }
    },
    [client, isReady, orgId],
  );

  useEffect(() => {
    fetchChannels(0);
  }, [fetchChannels]);

  const handleLoadMore = () => {
    fetchChannels(channels.length);
  };

  const handleStartEdit = (channel: Channel) => {
    const data = channel.data as Record<string, unknown> | undefined;
    setEditingId(channel.id);
    setEditTitle((data?.title as string) ?? "");
  };

  const handleConfirmEdit = (channel: Channel) => {
    const newTitle = editTitle.trim();
    if (newTitle) {
      const channelId = channel.id;
      // Optimistically update immediately
      setLocalTitles((prev) => new Map(prev).set(channelId, newTitle));
      // Persist in background, revert on error
      channel.updatePartial({ set: { title: newTitle } }).catch(() => {
        setLocalTitles((prev) => {
          const m = new Map(prev);
          m.delete(channelId);
          return m;
        });
      });
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
  };

  if (loading && channels.length === 0) {
    return <div className={styles.loading}>Loading sessions...</div>;
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Chat Sessions</h2>

      {channels.length === 0 ? (
        <p className={styles.empty}>No chat sessions yet. Start a new session from the home page.</p>
      ) : (
        <div className={styles.list}>
          {channels.map((ch) => {
            const data = ch.data as Record<string, unknown> | undefined;
            const rawTitle = (data?.title as string) || null;
            const title = localTitles.get(ch.id) ?? rawTitle;
            const firstMessage = ch.state.messages?.[0]?.text;
            const displayText = title || (firstMessage ? firstMessage.slice(0, 60) : "New session");
            const datasetId = (data?.datasetId as string) || null;
            const lastMessageAt = ch.state.last_message_at as string | undefined;

            if (editingId === ch.id) {
              return (
                <div key={ch.id} className={styles.sessionRow} data-testid={`session-${ch.id}`}>
                  <input
                    className={styles.editInput}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmEdit(ch);
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
                key={ch.id}
                className={styles.sessionRow}
                onClick={() => navigate(`/chat/${ch.id}`)}
                data-testid={`session-${ch.id}`}
              >
                <span className={styles.sessionTitle}>{displayText}</span>
                {datasetId && <DatasetBadge datasetId={datasetId} />}
                <span className={styles.sessionTimestamp}>
                  {formatRelativeTime(lastMessageAt)}
                </span>
                <button
                  className={styles.editButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(ch);
                  }}
                  title="Edit title"
                  data-testid={`edit-${ch.id}`}
                >
                  <PencilIcon className={styles.editIcon} />
                </button>
              </div>
            );
          })}

          {hasMore && (
            <button
              className={styles.loadMoreButton}
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
