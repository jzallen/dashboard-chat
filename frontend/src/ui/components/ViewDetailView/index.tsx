import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type View } from "@/dataCatalog";

import { executeViewToolCall } from "../../../core/toolCalls/viewTools";
import { useChatContext } from "../../context/ChatContext";
import { useViewQuery } from "../../hooks/useViewQuery";
import { ChatInput } from "../chat";
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

/** Collapsible SQL preview panel — shows display_sql (display types, for reference only). */
function SqlPreviewPanel({ displaySql }: { displaySql?: string }) {
  const [open, setOpen] = useState(false);

  if (!displaySql) return null;

  return (
    <div className={styles.section}>
      <button
        className={styles.sqlToggle}
        onClick={() => setOpen((v) => !v)}
        data-testid="sql-preview-toggle"
      >
        SQL Preview — for reference only {open ? "\u25B2" : "\u25BC"}
      </button>
      {open && (
        <pre className={styles.sqlPreview} data-testid="sql-preview-content">
          <code>{displaySql}</code>
        </pre>
      )}
    </div>
  );
}

/** Source dependency list with links to datasets/views. */
function SourceDependencyList({
  sourceRefs,
}: {
  sourceRefs: Array<{ id: string; type: "dataset" | "view" }>;
}) {
  if (sourceRefs.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Sources</div>
      <ul className={styles.sourceList} data-testid="source-dependency-list">
        {sourceRefs.map((ref) => (
          <li key={ref.id}>
            <Link
              to={ref.type === "dataset" ? `/table/${ref.id}` : `/view/${ref.id}`}
              className={styles.sourceLink}
            >
              {ref.id}
              <span className={styles.sourceType}>
                ({ref.type === "dataset" ? "Dataset" : "View"})
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Full view detail page with inline chat input and activity log. */
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
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>{view.name}</h1>
          <span className={styles.materialization}>{view.materialization}</span>
        </div>
        {view.description && <p className={styles.description}>{view.description}</p>}

        {view.columns.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Columns</div>
            <ViewSchemaTable view={view} />
          </div>
        )}

        <SqlPreviewPanel displaySql={view.display_sql} />
        <SourceDependencyList sourceRefs={view.source_refs} />
      </div>
      <ActivityLog
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />
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
    </div>
  );
}
