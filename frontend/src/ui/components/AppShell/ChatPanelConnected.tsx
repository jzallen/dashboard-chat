import { useCallback, useEffect } from "react";

import type { Dataset } from "@/dataCatalog";

import { useSessionContext } from "@/stream/useSessionContext";
import { useChatContext } from "../../context/ChatContext";
import ChatPanel from "../ChatPanel";

interface ChatPanelConnectedProps {
  projectId: string | null;
  onDatasetCreated?: () => void;
  onNavigateToDataset?: (datasetId: string) => void;
}

export function ChatPanelConnected({
  projectId,
  onDatasetCreated,
  onNavigateToDataset,
}: ChatPanelConnectedProps) {
  const {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
    handleStreamSubmit,
    inputRef,
    chatEndRef,
    isActive,
    addMessage,
    onDatasetCreated: notifyDatasetCreated,
    registerProjectUpdater,
    registerProjectId,
    registerCurrentChannel,
    resetSession,
    isStreaming,
    streamingContent,
  } = useChatContext();

  const { isFrozen, currentChannel } = useSessionContext(projectId);

  useEffect(() => {
    registerProjectId(projectId);
    return () => registerProjectId(null);
  }, [projectId, registerProjectId]);

  // W2 fix: wire currentChannel into chat engine so it targets the correct channel
  useEffect(() => {
    registerCurrentChannel(currentChannel);
    return () => registerCurrentChannel(null);
  }, [currentChannel, registerCurrentChannel]);

  useEffect(() => {
    if (onDatasetCreated) {
      registerProjectUpdater((_dataset: Dataset) => onDatasetCreated());
      return () => registerProjectUpdater(null);
    }
  }, [onDatasetCreated, registerProjectUpdater]);

  const handleAction = useCallback(
    (action: string) => {
      if (action === "create-dataset") {
        addMessage({
          id: String(Date.now()),
          role: "assistant",
          content: "Upload a CSV file to create a new dataset:",
          widget: { type: "upload" },
        });
      } else if (action === "new-session") {
        resetSession();
      }
    },
    [addMessage, resetSession]
  );

  const handleUploadComplete = useCallback(
    (dataset: Dataset) => {
      notifyDatasetCreated(dataset);
      onNavigateToDataset?.(dataset.id);
      addMessage({
        id: String(Date.now()),
        role: "assistant",
        content: "Dataset created! Click the dataset name in the breadcrumb to rename it.",
      });
    },
    [notifyDatasetCreated, onNavigateToDataset, addMessage]
  );

  const handleUploadError = useCallback(
    (error: string) => {
      addMessage({
        id: String(Date.now()),
        role: "assistant",
        content: `Something went wrong: ${error}`,
      });
    },
    [addMessage]
  );

  return (
    <ChatPanel
      messages={messages}
      input={isActive ? input : ""}
      setInput={setInput}
      isLoading={isLoading || !isActive}
      handleSubmit={handleSubmit}
      handleStreamSubmit={handleStreamSubmit}
      inputRef={inputRef}
      chatEndRef={chatEndRef}
      onAction={handleAction}
      projectId={projectId ?? undefined}
      onUploadComplete={handleUploadComplete}
      onUploadError={handleUploadError}
      isStreaming={isStreaming}
      streamingContent={streamingContent}
      isFrozen={isFrozen}
      channel={currentChannel}
    />
  );
}
