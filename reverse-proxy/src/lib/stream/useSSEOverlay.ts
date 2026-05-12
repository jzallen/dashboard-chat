import { useCallback, useState } from "react";

interface SSEOverlayState {
  isStreaming: boolean;
  streamingContent: string;
  startStreaming: () => void;
  updateContent: (content: string) => void;
  stopStreaming: () => void;
}

/**
 * Hook that manages streaming overlay state.
 * Shows a temporary text block below Stream's MessageList during active SSE turns.
 */
export function useSSEOverlay(): SSEOverlayState {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const startStreaming = useCallback(() => {
    setIsStreaming(true);
    setStreamingContent("");
  }, []);

  const updateContent = useCallback((content: string) => {
    setStreamingContent(content);
  }, []);

  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
    setStreamingContent("");
  }, []);

  return {
    isStreaming,
    streamingContent,
    startStreaming,
    updateContent,
    stopStreaming,
  };
}
