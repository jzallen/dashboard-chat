/* The assistant-dock context: the transient `chatOpen` state the old
   useNavigation.ts held, lifted into a small provider the layout route mounts.
   It stays out of the URL (a transient overlay). Lives in its own module so the
   shell, nav intents, and Overlays import it without cycling through the route
   module. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ChatApi = {
  chatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
};

const ChatContext = createContext<ChatApi | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const value = useMemo<ChatApi>(
    () => ({ chatOpen, openChat, closeChat }),
    [chatOpen, openChat, closeChat],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within the app shell");
  return ctx;
}
