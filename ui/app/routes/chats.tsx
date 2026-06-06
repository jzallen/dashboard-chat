/* /chats — the session list (domain vocabulary: ChatSession). */
import { ChatSessionList } from "../../src/app/ChatSessionList";
import { useNavIntents } from "../lib/nav";

export default function ChatsRoute() {
  const { go } = useNavIntents();
  return <ChatSessionList go={go} />;
}
