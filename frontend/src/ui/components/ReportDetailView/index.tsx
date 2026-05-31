import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { type ColumnMetadata } from "@/dataCatalog";

import { deriveAssistantChanges } from "../../../core/chat/assistantChanges";
import { executeReportToolCall } from "../../../core/toolCalls/reportTools";
import { useChatContext } from "../../context/ChatContext";
import { useModelDependencies } from "../../hooks/useModelDependencies";
import { useReportQuery } from "../../hooks/useReportQuery";
import { ChatInput } from "../chat";
import {
  AssistantChangesPanel,
  CompiledSqlPanel,
  DataPreviewGrid,
  DependencyStrip,
  ModelDetailLayout,
} from "../ModelDetail";
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

/** Full report detail page — single-page model-detail layout (MR-5). */
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
  const dependencies = useModelDependencies(report?.project_id, reportId);

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
    <ModelDetailLayout
      title={report.name}
      badges={
        <>
          <span className={styles.badge}>{report.report_type}</span>{" "}
          <span className={styles.badge}>{report.materialization}</span>{" "}
          <span className={styles.badge}>{report.domain}</span>
        </>
      }
      description={report.description}
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
            contextType="report"
            contextLabel={report.name}
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
        <ColumnsMetadataTable columns={report.columns_metadata} />
      </section>
      <CompiledSqlPanel sql={report.sql_definition} title="Compiled SQL" />
    </ModelDetailLayout>
  );
}
