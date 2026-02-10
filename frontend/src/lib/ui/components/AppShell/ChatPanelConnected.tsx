import { useCallback, useEffect } from "react";
import type { Dataset } from "@/api";
import { useChatContext } from "../../context/ChatContext";
import ChatPanel from "../ChatPanel";

interface ChatPanelConnectedProps {
  projectId: string;
  onDatasetCreated?: (dataset: Dataset) => void;
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
    inputRef,
    chatEndRef,
    isActive,
    addMessage,
    onDatasetCreated: notifyDatasetCreated,
    registerProjectUpdater,
  } = useChatContext();

  useEffect(() => {
    if (onDatasetCreated) {
      registerProjectUpdater(onDatasetCreated);
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
      }
    },
    [addMessage]
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
      inputRef={inputRef}
      chatEndRef={chatEndRef}
      onAction={handleAction}
      projectId={projectId}
      onUploadComplete={handleUploadComplete}
      onUploadError={handleUploadError}
    />
  );
}
