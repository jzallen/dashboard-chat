import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { type View } from "@/dataCatalog";

import { deriveAssistantChanges } from "../../../core/chat/assistantChanges";
import { executeViewToolCall } from "../../../core/toolCalls/viewTools";
import { useChatContext } from "../../context/ChatContext";
import { useModelDependencies } from "../../hooks/useModelDependencies";
import { useViewQuery } from "../../hooks/useViewQuery";
import { ChatInput } from "../chat";
import {
  AssistantChangesPanel,
  CompiledSqlPanel,
  DataPreviewGrid,
  DependencyStrip,
  ModelDetailLayout,
} from "../ModelDetail";
import { ActivityLog } from "../TableView/ActivityLog";
import styles from "./ViewDetailView.module.css";

/** Schema table showing structured columns with name, type, source, and grain role. */
function ViewSchemaTable({ view }: { view: View }) {
  const hasGrain = Boolean(view.grain);
  if (view.columns.length === 0) return null;
  return (
    <table className={styles.schemaTable} data-testid="view-schema-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Source</th>
          {hasGrain && <th>Grain Role</th>}
        </tr>
      </thead>
      <tbody>
        {view.columns.map((col) => (
          <tr key={col.name}>
            <td>{col.name}</td>
            <td>{col.display_type}</td>
            <td>{col.source_ref}</td>
            {hasGrain && <td>{col.grain_role ?? ""}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Full view detail page — single-page model-detail layout (MR-5). */
export function ViewDetailView() {
  const { viewId } = useParams<{ viewId: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    messages,
    input,
    setInput,
    isLoading: chatLoading,
    handleSubmit,
    registerToolHandler,
    setContext,
    channel,
    isStreaming,
    streamingContent,
  } = useChatContext();

  const { data: view, isLoading, isError } = useViewQuery(viewId);
  const dependencies = useModelDependencies(view?.project_id, viewId);

  // Set context when viewId changes
  useEffect(() => {
    if (viewId) {
      setContext("view", viewId);
    }
    return () => setContext(null, null);
  }, [viewId, setContext]);

  // Update channel's context if different from current
  useEffect(() => {
    if (channel && viewId) {
      const channelData = channel.data as Record<string, unknown> | undefined;
      const currentContextId = channelData?.contextId;
      if (currentContextId !== viewId) {
        channel
          .updatePartial({ set: { contextType: "view", contextId: viewId } })
          .catch(console.error);
      }
    }
  }, [channel, viewId]);

  // View tool call handler — delegates to viewTools.ts dispatcher
  const handleViewToolCall = useCallback(
    async (toolCall: { function: { name: string; arguments: string } }): Promise<string> => {
      if (!viewId || !view) return "No view context";
      const args = JSON.parse(toolCall.function.arguments);
      return executeViewToolCall(toolCall.function.name, args, {
        viewId,
        projectId: view.project_id,
        queryClient,
        navigate,
        setContext,
      });
    },
    [viewId, view, queryClient, navigate, setContext],
  );

  // Register tool handler with ChatContext
  useEffect(() => {
    registerToolHandler({ executeToolCall: handleViewToolCall });
    return () => registerToolHandler(null);
  }, [handleViewToolCall, registerToolHandler]);

  if (isLoading && !view) {
    return <div className={styles.loading}>Loading view...</div>;
  }

  if (isError || !view || !viewId) {
    return <div className={styles.loading}>View not found</div>;
  }

  return (
    <ModelDetailLayout
      title={view.name}
      badges={<span className={styles.materialization}>{view.materialization}</span>}
      description={view.description}
      activityLog={
        <ActivityLog
          messages={messages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
        />
      }
      inputBar={
        <div className={styles.inputBar}>
          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            isLoading={chatLoading}
            contextType="view"
            contextLabel={view.name}
          />
        </div>
      }
    >
      <DependencyStrip
        upstream={dependencies.upstream}
        downstream={dependencies.downstream}
        isLoading={dependencies.isLoading}
      />
      <AssistantChangesPanel changes={deriveAssistantChanges(messages)} />
      <DataPreviewGrid available={false} />
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Columns / Measures</div>
        <ViewSchemaTable view={view} />
      </section>
      <CompiledSqlPanel sql={view.sql_definition} title="Compiled SQL" />
    </ModelDetailLayout>
  );
}
