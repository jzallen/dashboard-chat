import { type RefObject, useEffect, useRef } from "react";

import type { Message } from "../../types";
import styles from "./chat.module.css";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: Message[];
  chatEndRef: RefObject<HTMLDivElement>;
}

export function MessageList({ messages, chatEndRef }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (isAtBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatEndRef]);

  return (
    <div
      ref={containerRef}
      className={styles.messageList}
      onScroll={() => {
        const el = containerRef.current;
        if (!el) return;
        isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      }}
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isStreaming={message.isStreaming ?? false}
        />
      ))}
      <div ref={chatEndRef} />
    </div>
  );
}
