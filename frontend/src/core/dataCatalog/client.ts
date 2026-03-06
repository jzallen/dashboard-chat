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
import type { EnvironmentStatusResponse, SqlAccessStatus } from "./sqlAccess";

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

    listDatasetsForProject(projectId: string): Promise<DatasetSparse[]> {
      return client.get<DatasetSparse[]>(`/api/projects/${projectId}/datasets`);
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

    startEnvironment(projectId: string): Promise<SqlAccessStatus> {
      return client.post<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access/environment/start`,
        {},
      );
    },

    stopEnvironment(projectId: string): Promise<SqlAccessStatus> {
      return client.post<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access/environment/stop`,
        {},
      );
    },

    restartEnvironment(projectId: string): Promise<SqlAccessStatus> {
      return client.post<SqlAccessStatus>(
        `/api/projects/${projectId}/sql-access/environment/restart`,
        {},
      );
    },

    getEnvironmentStatus(
      projectId: string,
    ): Promise<EnvironmentStatusResponse> {
      return client.get<EnvironmentStatusResponse>(
        `/api/projects/${projectId}/sql-access/environment/status`,
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
