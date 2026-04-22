import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { type ColumnMetadata, type Report } from "@/dataCatalog";

import { executeReportToolCall } from "../../../core/toolCalls/reportTools";
import { useChatContext } from "../../context/ChatContext";
import { useReportQuery } from "../../hooks/useReportQuery";
import { ChatInput } from "../chat";
import { ActivityLog } from "../TableView/ActivityLog";
import styles from "./ReportDetailView.module.css";

/** Schema table showing column metadata with name, role, type, and description. */
function ColumnsMetadataTable({ columns }: { columns: ColumnMetadata[] }) {
  if (columns.length === 0) return null;
  return (
    <table className={styles.metadataTable} data-testid="columns-metadata-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Role</th>
          <th>Type</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col) => (
          <tr key={col.name}>
            <td>{col.name}</td>
            <td>{col.semantic_role}</td>
            <td>{col.semantic_type}</td>
            <td>{col.description ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Collapsible SQL preview panel. */
function SqlPreviewPanel({ sqlDefinition }: { sqlDefinition?: string }) {
  const [open, setOpen] = useState(false);

  if (!sqlDefinition) return null;

  return (
    <div className={styles.section}>
      <button
        className={styles.sqlToggle}
        onClick={() => setOpen((v) => !v)}
        data-testid="sql-preview-toggle"
      >
        SQL Definition {open ? "\u25B2" : "\u25BC"}
      </button>
      {open && (
        <pre className={styles.sqlPreview} data-testid="sql-preview-content">
          <code>{sqlDefinition}</code>
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

/** Full report detail page with inline chat input and activity log. */
export function ReportDetailView() {
  const { reportId } = useParams<{ reportId: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    messages,
    input,
    setInput,
    isLoading: chatLoading,
    handleSubmit,
    registerToolHandler,
    registerTableSchema,
    setContext,
    channel,
    isStreaming,
    streamingContent,
  } = useChatContext();

  const { data: report, isLoading, isError } = useReportQuery(reportId);

  // Set context when reportId changes
  useEffect(() => {
    if (reportId) {
      setContext("report", reportId);
    }
    return () => setContext(null, null);
  }, [reportId, setContext]);

  // Build tableSchema with layerContext for the agent
  useEffect(() => {
    if (!report) {
      registerTableSchema(null);
      return;
    }
    registerTableSchema({
      columns: [],
      rowCount: 0,
      layerContext: {
        layer: "report",
        modelName: report.name,
        sqlDefinition: report.sql_definition,
        sourceSchemas: report.source_refs.map((ref) => `${ref.type}:${ref.id}`),
      },
    });
    return () => registerTableSchema(null);
  }, [report, registerTableSchema]);

  // Update channel's context if different from current
  useEffect(() => {
    if (channel && reportId) {
      const channelData = channel.data as Record<string, unknown> | undefined;
      const currentContextId = channelData?.contextId;
      if (currentContextId !== reportId) {
        channel
          .updatePartial({ set: { contextType: "report", contextId: reportId } })
          .catch(console.error);
      }
    }
  }, [channel, reportId]);

  // Report tool call handler — delegates to reportTools.ts dispatcher
  const handleReportToolCall = useCallback(
    async (toolCall: { function: { name: string; arguments: string } }): Promise<string> => {
      if (!reportId || !report) return "No report context";
      const args = JSON.parse(toolCall.function.arguments);
      return executeReportToolCall(toolCall.function.name, args, {
        reportId,
        projectId: report.project_id,
        queryClient,
        navigate,
        setContext,
      });
    },
    [reportId, report, queryClient, navigate, setContext],
  );

  // Register tool handler with ChatContext
  useEffect(() => {
    registerToolHandler({ executeToolCall: handleReportToolCall });
    return () => registerToolHandler(null);
  }, [handleReportToolCall, registerToolHandler]);

  if (isLoading && !report) {
    return <div className={styles.loading}>Loading report...</div>;
  }

  if (isError || !report || !reportId) {
    return <div className={styles.loading}>Report not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>{report.name}</h1>
          <div>
            <span className={styles.badge}>{report.report_type}</span>{" "}
            <span className={styles.badge}>{report.materialization}</span>{" "}
            <span className={styles.badge}>{report.domain}</span>
          </div>
        </div>
        {report.description && <p className={styles.description}>{report.description}</p>}

        {report.columns_metadata.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Columns Metadata</div>
            <ColumnsMetadataTable columns={report.columns_metadata} />
          </div>
        )}

        <SqlPreviewPanel sqlDefinition={report.sql_definition} />
        <SourceDependencyList sourceRefs={report.source_refs} />
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
          contextType="report"
          contextLabel={report.name}
        />
      </div>
    </div>
  );
}
