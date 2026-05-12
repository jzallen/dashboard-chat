import type { StreamChat } from "stream-chat";

import { useStreamContext } from "./StreamProvider";

/**
 * Hook to access the initialized Stream client.
 * Returns null if Stream is not configured or not yet connected.
 */
export function useStreamClient(): StreamChat | null {
  const { client } = useStreamContext();
  return client;
}
