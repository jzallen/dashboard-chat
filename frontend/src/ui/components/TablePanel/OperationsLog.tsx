import { useEffect, useRef, useState } from "react";
import type { Channel, Event } from "stream-chat";

import styles from "./TablePanel.module.css";

interface OperationEntry {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  timestamp: string;
  persisted: boolean;
}

interface SSEToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
}

interface OperationsLogProps {
  channel: Channel | null;
  sseToolCalls?: SSEToolCall[];
}

/**
 * Subscribes to the active Stream channel, filters messages for tool calls,
 * and displays a chronological operations log.
 */
export function OperationsLog({ channel, sseToolCalls }: OperationsLogProps) {
  const [entries, setEntries] = useState<OperationEntry[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const sseToolCallIds = useRef<Set<string>>(new Set());

  // Populate from channel history
  useEffect(() => {
    if (!channel) {
      setEntries([]);
      return;
    }

    const historyEntries: OperationEntry[] = [];
    const messages = channel.state.messages || [];

    for (const msg of messages) {
      const custom = (msg as Record<string, unknown>).custom as Record<string, unknown> | undefined;
      const toolCalls = custom?.tool_calls as Array<{
        id?: string;
        name: string;
        args: Record<string, unknown>;
        result?: string;
      }> | undefined;

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          historyEntries.push({
            id: tc.id || `${msg.id}-${tc.name}`,
            toolName: tc.name,
            args: tc.args || {},
            result: tc.result,
            timestamp: (msg.created_at as string) || new Date().toISOString(),
            persisted: true,
          });
        }
      }
    }

    setEntries(historyEntries);
  }, [channel]);

  // Merge SSE tool calls as unpersisted entries (deduped when Stream confirms)
  useEffect(() => {
    if (!sseToolCalls || sseToolCalls.length === 0) return;

    setEntries((prev) => {
      const updated = [...prev];
      for (const tc of sseToolCalls) {
        if (!updated.some((e) => e.id === tc.id)) {
          sseToolCallIds.current.add(tc.id);
          updated.push({
            id: tc.id,
            toolName: tc.toolName,
            args: tc.args,
            result: tc.result,
            timestamp: new Date().toISOString(),
            persisted: false,
          });
        }
      }
      return updated;
    });
  }, [sseToolCalls]);

  // Subscribe to new messages for live updates
  useEffect(() => {
    if (!channel) return;

    const handleNewMessage = (event: Event) => {
      const msg = event.message;
      if (!msg) return;

      const custom = (msg as Record<string, unknown>).custom as Record<string, unknown> | undefined;
      const toolCalls = custom?.tool_calls as Array<{
        id?: string;
        name: string;
        args: Record<string, unknown>;
        result?: string;
      }> | undefined;

      if (!toolCalls || toolCalls.length === 0) return;

      setEntries((prev) => {
        const newEntries = [...prev];
        for (const tc of toolCalls) {
          const tcId = tc.id || `${msg.id}-${tc.name}`;

          // Dedup: if this tool call was already delivered via SSE, mark as persisted
          const existingIdx = newEntries.findIndex((e) => e.id === tcId);
          if (existingIdx >= 0) {
            newEntries[existingIdx] = { ...newEntries[existingIdx], persisted: true };
          } else {
            newEntries.push({
              id: tcId,
              toolName: tc.name,
              args: tc.args || {},
              result: tc.result,
              timestamp: (msg.created_at as string) || new Date().toISOString(),
              persisted: true,
            });
          }
        }
        return newEntries;
      });
    };

    channel.on("message.new", handleNewMessage);
    return () => {
      channel.off("message.new", handleNewMessage);
    };
  }, [channel]);

  if (entries.length === 0) return null;

  return (
    <div className={styles.opsLog}>
      <button
        type="button"
        className={styles.opsLogToggle}
        onClick={() => setCollapsed((v) => !v)}
      >
        Operations Log ({entries.length}) {collapsed ? "+" : "-"}
      </button>
      {!collapsed && (
        <div className={styles.opsLogEntries}>
          {entries.map((entry) => (
            <div key={entry.id} className={styles.opsLogEntry}>
              <span className={styles.opsLogTool}>{entry.toolName}</span>
              <span className={styles.opsLogArgs}>
                {Object.entries(entry.args)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(", ")}
              </span>
              {entry.result && (
                <span className={styles.opsLogResult}>{entry.result}</span>
              )}
              <span className={styles.opsLogTime}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Export types for SSE dedup tracking
export { type OperationEntry, type SSEToolCall };
