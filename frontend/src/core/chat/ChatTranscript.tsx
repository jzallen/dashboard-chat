import { useEffect, useState } from "react";

import type { ChatEvent } from "./events";

export type ChatEventSource = {
  subscribe: (fn: (event: ChatEvent) => void) => () => void;
};

type Props = {
  source: ChatEventSource;
};

/**
 * Renders the accumulated assistant_text_delta stream from a ChatEventSource.
 * Used as the thin slice for AC3 — proves MockSSESource drives component state.
 */
export function ChatTranscript({ source }: Props) {
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    const unsubscribe = source.subscribe((event) => {
      if (event.type === "assistant_text_delta") {
        setTranscript((prev) => prev + event.delta);
      }
    });
    return unsubscribe;
  }, [source]);

  return <div data-testid="chat-transcript">{transcript}</div>;
}
