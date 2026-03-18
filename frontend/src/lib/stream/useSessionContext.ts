import { useCallback, useState } from "react";
import type { Channel } from "stream-chat";

import { compactId, sessionHash } from "./channelId";
import { useStreamClient } from "./useStreamClient";

interface SessionContextValue {
  currentChannel: Channel | null;
  createSession: (orgId: string) => Promise<Channel>;
  resumeSession: (channelId: string) => Promise<Channel>;
  queryChannels: (orgId: string, limit?: number) => Promise<Channel[]>;
}

/**
 * Manages Stream channels scoped to org.
 * Channel creation is explicit (no auto-create on mount).
 */
export function useSessionContext(orgId: string | null): SessionContextValue {
  const client = useStreamClient();
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);

  const createSession = useCallback(
    async (oid: string): Promise<Channel> => {
      if (!client) throw new Error("Stream client not ready");

      const userId = client.userID ?? "anon";
      const suffix = await sessionHash(oid, userId);
      const sessionId = `chat_${compactId(oid)}_${suffix}`;

      const channel = client.channel("messaging", sessionId, {
        orgId: oid,
        projectId: null,
        datasetId: null,
        title: null,
        createdAt: new Date().toISOString(),
      });
      await channel.watch();

      setCurrentChannel(channel);
      return channel;
    },
    [client],
  );

  const resumeSession = useCallback(
    async (channelId: string): Promise<Channel> => {
      if (!client) throw new Error("Stream client not ready");

      const channel = client.channel("messaging", channelId);
      await channel.watch();
      setCurrentChannel(channel);
      return channel;
    },
    [client],
  );

  const queryChannels = useCallback(
    async (oid: string, limit = 30): Promise<Channel[]> => {
      if (!client) throw new Error("Stream client not ready");

      return client.queryChannels(
        {
          type: "messaging" as const,
          "custom.orgId": oid,
        },
        [{ last_message_at: -1 as const }],
        { limit },
      );
    },
    [client],
  );

  return {
    currentChannel,
    createSession,
    resumeSession,
    queryChannels,
  };
}
