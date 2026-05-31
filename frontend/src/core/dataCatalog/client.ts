import { ApiClient } from "@/http/apiClient";
import { DATA_CATALOG_BASE_URL } from "@/http/config";

import type {
  Dataset,
  DatasetSparse,
  DatasetUpdate,
  PreviewRequest,
  PreviewResponse,
  TransformCreate,
  TransformUpdate,
} from "./datasets";
import type { Project } from "./projects";
import type {
  QueryEngineDetail,
  QueryEngineNode,
  QueryEngineTestResult,
} from "./queryEngines";
import type { Report, ReportCreate, ReportUpdate } from "./reports";
import type { ProjectMemory, Session, SessionsPage } from "./sessions";
import type { SqlAccessStatus } from "./sqlAccess";
import type { View, ViewCreate, ViewUpdate } from "./views";

export interface OrgInfo {
  id: string;
  name: string;
}

export interface FormatInfo {
  name: string;
  extensions: string[];
  label: string;
}

export function createDataCatalog(fetchFn: typeof fetch = fetch) {
  const client = new ApiClient(DATA_CATALOG_BASE_URL, {
    fetchFn,
    unwrapData: true,
  });

  return {
    // Datasets
    listDatasets(projectId?: string): Promise<Dataset[]> {
      const query = projectId ? `?project_id=${projectId}` : "";
      return client.get<Dataset[]>(`/api/datasets${query}`);
    },

    getDataset(
      datasetId: string,
      options?: {
        includeTransforms?: boolean;
        includePreview?: boolean;
        previewLimit?: number;
      },
    ): Promise<Dataset> {
      const params = new URLSearchParams();
      if (options?.includeTransforms !== undefined) {
        params.append("include_transforms", String(options.includeTransforms));
      }
      if (options?.includePreview) {
        params.append("include_preview", "true");
        if (options.previewLimit) {
          params.append("preview_limit", String(options.previewLimit));
        }
      }
      const query = params.toString() ? `?${params.toString()}` : "";
      return client.get<Dataset>(`/api/datasets/${datasetId}${query}`);
    },

    updateDataset(datasetId: string, data: DatasetUpdate): Promise<Dataset> {
      return client.patch<Dataset>(`/api/datasets/${datasetId}`, data);
    },

    // MR-7: cold storage / retention. Thin POSTs (no body) over the existing
    // dataset record — archive moves a source to cold storage (sets archived_at +
    // retention_until server-side), restore brings it back (clears both).
    archiveDataset(datasetId: string): Promise<Dataset> {
      return client.post<Dataset>(`/api/datasets/${datasetId}/archive`, {});
    },

    restoreDataset(datasetId: string): Promise<Dataset> {
      return client.post<Dataset>(`/api/datasets/${datasetId}/restore`, {});
    },

    createTransform(datasetId: string, data: TransformCreate): Promise<void> {
      return client.post(`/api/datasets/${datasetId}/transforms`, {
        transforms: [data],
      });
    },

    updateTransform(
      datasetId: string,
      transformId: string,
      data: TransformUpdate,
    ): Promise<void> {
      return client.patch(`/api/datasets/${datasetId}/transforms`, {
        updates: [{ id: transformId, ...data }],
      });
    },

    deleteTransform(datasetId: string, transformId: string): Promise<void> {
      return client.patch(`/api/datasets/${datasetId}/transforms`, {
        updates: [{ id: transformId, status: "deleted" }],
      });
    },

    toggleTransform(
      datasetId: string,
      transformId: string,
      enabled: boolean,
    ): Promise<void> {
      return client.patch(`/api/datasets/${datasetId}/transforms`, {
        updates: [
          { id: transformId, status: enabled ? "enabled" : "disabled" },
        ],
      });
    },

    previewCleaningTransform(
      datasetId: string,
      config: PreviewRequest,
    ): Promise<PreviewResponse> {
      return client.post<PreviewResponse>(
        `/api/datasets/${datasetId}/transforms/preview`,
        config,
      );
    },

    createCleaningTransforms(
      datasetId: string,
      transforms: TransformCreate[],
    ): Promise<void> {
      return client.post(`/api/datasets/${datasetId}/transforms`, {
        transforms,
      });
    },

    listDatasetsForProject(
      projectId: string,
      options?: { archived?: boolean },
    ): Promise<DatasetSparse[]> {
      // MR-7: ?archived=true returns ONLY archived sources (the cold-storage list);
      // omitted/false returns the live datasets (archived excluded server-side).
      const query = options?.archived ? "?archived=true" : "";
      return client.get<DatasetSparse[]>(
        `/api/projects/${projectId}/datasets${query}`,
      );
    },

    // Projects
    listProjects(): Promise<Project[]> {
      return client.get<Project[]>("/api/projects");
    },

    getProject(projectId: string): Promise<Project> {
      return client.get<Project>(`/api/projects/${projectId}`);
    },

    async exportDbtProject(projectId: string): Promise<void> {
      const response = await client.fetch(
        `/api/projects/${projectId}/export/dbt`,
        {
          method: "GET",
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Export failed: ${response.status} ${errorText}`);
      }

      const blob = await response.blob();

      const disposition = response.headers.get("Content-Disposition");
      let filename = "export.zip";
      if (disposition) {
        const match = disposition.match(/filename="?([^";\s]+)"?/);
        if (match) filename = match[1];
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    },

    // Views
    listViews(projectId: string): Promise<View[]> {
      return client.get<View[]>(`/api/projects/${projectId}/views`);
    },

    getView(viewId: string): Promise<View> {
      return client.get<View>(`/api/views/${viewId}`);
    },

    createView(projectId: string, data: ViewCreate): Promise<View> {
      return client.post<View>(`/api/projects/${projectId}/views`, data);
    },

    updateView(viewId: string, data: ViewUpdate): Promise<View> {
      return client.patch<View>(`/api/views/${viewId}`, data);
    },

    deleteView(viewId: string): Promise<void> {
      return client.del(`/api/views/${viewId}`);
    },

    // Reports
    listReports(projectId: string): Promise<Report[]> {
      return client.get<Report[]>(`/api/projects/${projectId}/reports`);
    },

    getReport(reportId: string): Promise<Report> {
      return client.get<Report>(`/api/reports/${reportId}`);
    },

    createReport(projectId: string, data: ReportCreate): Promise<Report> {
      return client.post<Report>(`/api/projects/${projectId}/reports`, data);
    },

    updateReport(reportId: string, data: ReportUpdate): Promise<Report> {
      return client.patch<Report>(`/api/reports/${reportId}`, data);
    },

    deleteReport(reportId: string): Promise<void> {
      return client.del(`/api/reports/${reportId}`);
    },

    // SQL Access
    enableSqlAccess(projectId: string): Promise<SqlAccessStatus> {
      return client.post<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access`,
        {},
      );
    },

    disableSqlAccess(projectId: string): Promise<void> {
      return client.del(`/api/projects/${projectId}/sql-access`);
    },

    getSqlAccess(projectId: string): Promise<SqlAccessStatus> {
      return client.get<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access`,
      );
    },

    syncSqlAccess(projectId: string): Promise<SqlAccessStatus> {
      return client.post<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access/sync`,
        {},
      );
    },

    regenerateSqlCredentials(projectId: string): Promise<SqlAccessStatus> {
      return client.post<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access/credentials`,
        {},
      );
    },

    // Query Engines
    listQueryEngines(): Promise<QueryEngineNode[]> {
      return client.get<QueryEngineNode[]>("/api/query-engines");
    },

    getQueryEngine(nodeId: string): Promise<QueryEngineDetail> {
      return client.get<QueryEngineDetail>(`/api/query-engines/${nodeId}`);
    },

    testQueryEngine(nodeId: string): Promise<QueryEngineTestResult> {
      return client.post<QueryEngineTestResult>(
        `/api/query-engines/${nodeId}/test`,
        {},
      );
    },

    // Memory
    getProjectMemory(projectId: string): Promise<ProjectMemory> {
      return client.get<ProjectMemory>(`/api/projects/${projectId}/memory`);
    },

    // Sessions
    createSession(projectId: string): Promise<Session> {
      return client.post<Session>(`/api/projects/${projectId}/sessions`, {});
    },

    async listSessions(
      projectId: string,
      options?: { after?: string; size?: number },
    ): Promise<SessionsPage> {
      const params = new URLSearchParams();
      if (options?.after) params.append("page[after]", options.after);
      if (options?.size) params.append("page[size]", String(options.size));
      const query = params.toString() ? `?${params.toString()}` : "";
      // Backend returns JSON:API envelope — unwrap into flat SessionsPage shape
      const response = await client.fetch(`/api/projects/${projectId}/sessions${query}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list sessions: ${response.status} ${errorText}`);
      }
      const json = await response.json();
      // Flatten JSON:API resource objects {type, id, attributes} → flat Session objects
      const data = (json.data ?? []).map(
        (resource: { id: string; attributes: Record<string, unknown> }) => ({
          id: resource.id,
          ...resource.attributes,
        }),
      );
      const has_more = json.meta?.page?.has_more ?? false;
      // Extract cursor from links.next URL param, or null
      let next_cursor: string | null = null;
      if (json.links?.next) {
        const nextUrl = new URL(json.links.next, window.location.origin);
        next_cursor = nextUrl.searchParams.get("page[after]");
      }
      return { data, meta: { next_cursor, has_more } } as SessionsPage;
    },

    updateSession(
      projectId: string,
      sessionId: string,
      data: { title: string },
    ): Promise<Session> {
      return client.patch<Session>(
        `/api/projects/${projectId}/sessions/${sessionId}`,
        data,
      );
    },

    // Org
    getOrgInfo(): Promise<OrgInfo> {
      return client.get<OrgInfo>("/api/orgs/me");
    },

    // Formats
    async getFormats(): Promise<FormatInfo[]> {
      const response = await client.fetch("/api/uploads/formats");
      if (!response.ok) throw new Error("Failed to fetch formats");
      const json = await response.json();
      return json.formats;
    },

    // Upload
    uploadFile<T>(
      endpoint: string,
      file: File,
      additionalFields: Record<string, string>,
    ): Promise<T> {
      return client.uploadFile<T>(endpoint, file, additionalFields);
    },

    processUploadWithChoices<T>(
      uploadId: string,
      choices: Record<string, string>,
    ): Promise<T> {
      return client.post<T>(`/api/uploads/${uploadId}/process`, { choices });
    },

    // Auth bootstrap (no auth wrapper needed)
    createOrg(name: string): Promise<OrgInfo> {
      return client.post<OrgInfo>("/api/orgs", { name });
    },
  };
}

export type DataCatalog = ReturnType<typeof createDataCatalog>;
