import { useCallback, useEffect, useRef, useState } from "react";
import type { Channel } from "stream-chat";

import { useStreamClient } from "./useStreamClient";

const FREEZE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SessionContextValue {
  currentChannel: Channel | null;
  isFrozen: boolean;
  createSession: (projectId: string) => Promise<Channel>;
  switchSession: (channelId: string) => Promise<void>;
}

/**
 * Manages current Stream channel (project-scoped sessions).
 * Handles channel creation, lazy freeze detection, and session switching.
 */
export function useSessionContext(projectId: string | null): SessionContextValue {
  const client = useStreamClient();
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const initRef = useRef(false);

  const checkAndFreeze = useCallback(async (channel: Channel) => {
    const messages = channel.state.messages;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      setIsFrozen(false);
      return false;
    }

    const lastTime = new Date(lastMessage.created_at as string).getTime();
    const isStale = Date.now() - lastTime > FREEZE_THRESHOLD_MS;
    const alreadyFrozen = !!(channel.data as Record<string, unknown>)?.frozenAt;

    if (isStale && !alreadyFrozen) {
      await channel.updatePartial({ set: { frozenAt: new Date().toISOString() } });
    }

    const frozen = isStale || alreadyFrozen;
    setIsFrozen(frozen);
    return frozen;
  }, []);

  const createSession = useCallback(
    async (pid: string): Promise<Channel> => {
      if (!client) throw new Error("Stream client not ready");

      const sessionId = `project_${pid}_${crypto.randomUUID()}`;
      const channel = client.channel("messaging", sessionId, {
        projectId: pid,
        createdAt: new Date().toISOString(),
        frozenAt: null,
      });
      await channel.watch();

      setCurrentChannel(channel);
      setIsFrozen(false);
      return channel;
    },
    [client],
  );

  const switchSession = useCallback(
    async (channelId: string) => {
      if (!client) throw new Error("Stream client not ready");

      const channel = client.channel("messaging", channelId);
      await channel.watch();
      await checkAndFreeze(channel);
      setCurrentChannel(channel);
    },
    [client, checkAndFreeze],
  );

  // Auto-create session when project loads and no active channel exists
  useEffect(() => {
    if (!client || !projectId || initRef.current) return;
    initRef.current = true;

    async function initSession() {
      if (!client || !projectId) return;

      // Query for existing non-frozen channels for this project
      const filter = {
        type: "messaging" as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "custom.projectId": projectId as any,
      };
      const sort = [{ last_message_at: -1 as const }];
      const channels = await client.queryChannels(filter, sort, { limit: 10 });

      // Find an active (non-frozen) channel
      const activeChannel = channels.find((ch) => {
        return !(ch.data as Record<string, unknown>)?.frozenAt;
      });

      if (activeChannel) {
        await checkAndFreeze(activeChannel);
        if (!(activeChannel.data as Record<string, unknown>)?.frozenAt) {
          setCurrentChannel(activeChannel);
          return;
        }
      }

      // No active channel — create a new one
      await createSession(projectId);
    }

    initSession();

    return () => {
      initRef.current = false;
    };
  }, [client, projectId, checkAndFreeze, createSession]);

  return {
    currentChannel,
    isFrozen,
    createSession,
    switchSession,
  };
}
