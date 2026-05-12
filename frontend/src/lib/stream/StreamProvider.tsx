import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { StreamChat } from "stream-chat";
import { Chat } from "stream-chat-react";

import { getAuthHeaders } from "@/auth/tokenStorage";
import { DATA_CATALOG_BASE_URL } from "@/http/config";

import { useAuth } from "../../ui/context/AuthContext/AuthProvider";

const STREAM_API_KEY = import.meta.env.VITE_STREAM_API_KEY;

interface StreamContextValue {
  client: StreamChat | null;
  isReady: boolean;
}

const StreamContext = createContext<StreamContextValue>({ client: null, isReady: false });

async function fetchStreamToken(): Promise<string> {
  const headers = getAuthHeaders();
  const response = await fetch(`${DATA_CATALOG_BASE_URL}/api/stream/stream-token`, {
    headers: { "Content-Type": "application/json", ...headers },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Stream token: ${response.status}`);
  }
  const data = await response.json();
  return data.token;
}

export function StreamProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [client, setClient] = useState<StreamChat | null>(null);
  const [isReady, setIsReady] = useState(false);
  const connectingRef = useRef(false);

  useEffect(() => {
    if (!STREAM_API_KEY || !isAuthenticated || !user) {
      return;
    }

    if (connectingRef.current) return;
    connectingRef.current = true;

    const chatClient = StreamChat.getInstance(STREAM_API_KEY);

    async function connect() {
      try {
        await chatClient.connectUser(
          { id: user!.id, name: user!.name ?? user!.email },
          fetchStreamToken,
        );
        setClient(chatClient);
        setIsReady(true);
      } catch (err) {
        console.error("Stream connection failed:", err);
        connectingRef.current = false;
      }
    }

    connect();

    return () => {
      connectingRef.current = false;
      setIsReady(false);
      setClient(null);
      chatClient.disconnectUser().catch(() => {});
    };
  }, [isAuthenticated, user]);

  if (!STREAM_API_KEY) {
    return <>{children}</>;
  }

  if (!client || !isReady) {
    return <>{children}</>;
  }

  return (
    <StreamContext.Provider value={{ client, isReady }}>
      <Chat client={client}>{children}</Chat>
    </StreamContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStreamContext(): StreamContextValue {
  return useContext(StreamContext);
}
