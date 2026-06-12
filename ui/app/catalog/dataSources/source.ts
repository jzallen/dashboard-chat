/**
 * CatalogSource — the port the catalog reads through. It exposes the raw,
 * unprocessed catalog payloads; {@link createDataCatalog} (../client.ts) layers
 * the query/projection logic on top. Implement this over any backing store: the
 * bundled fixtureSource (./fixtureSource.ts) today, an HTTP client later — both
 * live here in dataSources/ alongside this port.
 *
 * Pure: types only, no concrete data dependency. The fixture cast lives in the
 * adapter that implements this interface, not here.
 */
import type { AuditEntry, Edge, LineageNode, ModelKind } from "../lineage";
import type {
  ChatHistoryItem,
  ChatScript,
  CurrentProject,
  DbtFile,
  OrgSettings,
  ProjectSummary,
} from "../models";
import type { BackendSource } from "./lineageMappers";

/**
 * A source's uploaded file as the upload modal's Files list renders it. Mapped
 * from the backend's snake_case upload resource: `name` ← `original_filename`,
 * `rows` ← `row_count` (null for a still-pending upload), `when` is a short
 * formatted date/relative string from `created_at`, `status` passes through
 * (`"ingested"` | `"pending"`).
 */
export type SourceUpload = {
  name: string;
  rows: number | null;
  when: string;
  status: string;
};

export interface CatalogSource {
  getProjects(): Promise<ProjectSummary[]>;
  getCurrentProject(): Promise<CurrentProject>;
  getOrg(): Promise<OrgSettings>;
  getRecents(): Promise<ChatHistoryItem[]>;
  getAllChats(): Promise<ChatHistoryItem[]>;
  getNodes(): Promise<Record<string, LineageNode>>;
  getEdges(): Promise<Edge[]>;
  getAudit(): Promise<Record<string, AuditEntry[]>>;
  getChatScript(): Promise<ChatScript>;
  getDbtFiles(): Promise<DbtFile[]>;
  /**
   * The catalog's first WRITE port (optional — only backend sources implement
   * it). Enable/disable the transform a transform-type audit entry produced.
   * Resolves on success; REJECTS on failure so the optimistic write-through
   * rolls the catalog's optimistic flip back. A source that does not back writes
   * (the fixture fallback) simply omits it.
   */
  toggleAuditEntry?(auditEntryId: string, enabled: boolean): Promise<void>;
  /**
   * Rename a model-bearing node (dataset/view/report) by id. The `kind` selects
   * the backing endpoint; the active project scope is the source's own concern.
   * Resolves on success; REJECTS on failure so the optimistic rename rolls back.
   * Source-layer nodes have no backend entity and are never passed here.
   */
  renameModel?(id: string, kind: ModelKind, name: string): Promise<void>;
  /**
   * Archive a model-bearing node (soft-delete). Only datasets support archival
   * (a restorable Cold Storage); the impl no-ops for kinds the backend can't
   * soft-delete. Rejects on failure so the optimistic archive rolls back.
   */
  archiveModel?(id: string, kind: ModelKind): Promise<void>;
  /** Restore a previously archived model. Mirrors {@link archiveModel}. */
  restoreModel?(id: string, kind: ModelKind): Promise<void>;
  /**
   * Create a dataset by uploading a file (multipart, one step). The active
   * project scope is the source's own concern. Resolves with the new dataset's
   * id; rejects on failure.
   */
  createDataset?(file: File): Promise<{ id: string }>;
  /* ─── Source-from-upload saga ports (the browser is the saga coordinator) ─── */
  /**
   * List the active project's Sources (for the lineage canvas). Resolves the
   * unwrapped backend source list; rejects on a fetch/auth error.
   */
  getSources?(): Promise<BackendSource[]>;
  /**
   * List the files uploaded to a Source (backs the upload modal's Files list).
   * Resolves the mapped {@link SourceUpload}[] (both ingested and pending);
   * rejects on a fetch/auth error.
   */
  getSourceUploads?(sourceId: string): Promise<SourceUpload[]>;
  /**
   * Create a Source (the logical table behind one or more uploaded files). The
   * active project scope is the source's own concern. Resolves with the new
   * Source's id; rejects on failure (the saga reports `source_upload_failed`).
   */
  createSource?(name: string): Promise<{ id: string }>;
  /**
   * Record an Upload against a Source and mint a presigned PUT URL. Returns the
   * RAW 202 body (`{uploadId, putUrl, storageKey}`) — the browser PUTs the bytes
   * itself ({@link putToStorage}); the app server writes NO bytes here.
   */
  requestUpload?(
    sourceId: string,
    file: File,
  ): Promise<{ uploadId: string; putUrl: string; storageKey: string }>;
  /**
   * Upload the file bytes DIRECTLY to MinIO via the presigned `putUrl` — a plain
   * `fetch`, NOT through the app/auth-proxy (no Authorization header, no session
   * cookie). The presign was signed with a `ContentType`, so the PUT MUST send
   * `Content-Type: file.type` or MinIO rejects the signature. Rejects on a
   * non-2xx storage response.
   */
  putToStorage?(putUrl: string, file: File): Promise<void>;
  /**
   * Trigger ingestion: the server reads the object back from MinIO, validates +
   * ingests it, and creates/links (first upload) or appends-on-schema-match
   * (subsequent uploads) the staging Dataset. Resolves with the linked/appended
   * dataset id; rejects on a 4xx — notably a 422 SchemaMismatch (whose body
   * carries the offending columns) the saga reports as `source_upload_failed`
   * and the surface renders as a recovery affordance. `choices` carries a sheet
   * selection for the `awaiting_input` path.
   */
  processUpload?(
    sourceId: string,
    uploadId: string,
    choices?: Record<string, unknown>,
  ): Promise<{ datasetId: string }>;
  /**
   * Drop any cached per-project reads (e.g. a memoized lineage fetch) so the
   * next read re-fetches fresh. Called before a write-triggered revalidation so
   * the new server state is observed, not a stale cache. No-op for sources that
   * don't cache.
   */
  invalidateScope?(projectId: string): void;
  /**
   * Drop any cached ORG-GLOBAL reads (e.g. a memoized project-list fetch) so
   * the next read re-fetches fresh. Called by `refreshOrgGlobal` before its
   * re-reads — without this, a memoizing source re-serves the first (possibly
   * pre-onboarding, empty) result forever. No-op for sources that don't cache.
   */
  invalidateOrgGlobal?(): void;
}

/**
 * A primary source need only implement the getters it actually backs. The rest
 * are filled from the complete fallback in {@link createDataCatalog}. The fixture
 * source is a complete {@link CatalogSource}; a backend source (e.g.
 * metadataApiSource) is a `PartialCatalogSource` — it implements only what the
 * API can answer and never references the fallback.
 */
export type PartialCatalogSource = Partial<CatalogSource>;

/**
 * The raw catalog payload shape — the ten top-level collections a concrete
 * {@link CatalogSource} backing store exposes (e.g. the fixtureData.js fixture). The
 * adapter asserts its untyped data against this once, then serves each field
 * through the {@link CatalogSource} getters.
 */
export interface RawCatalog {
  PROJECTS: ProjectSummary[];
  PROJECT: CurrentProject;
  ORG: OrgSettings;
  RECENTS: ChatHistoryItem[];
  ALL_CHATS: ChatHistoryItem[];
  NODES: Record<string, LineageNode>;
  EDGES: Edge[];
  AUDIT: Record<string, AuditEntry[]>;
  CHAT_SCRIPT: ChatScript;
  DBT_FILES: DbtFile[];
}
