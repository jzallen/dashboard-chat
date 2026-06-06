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
import type { AuditEntry, Edge, LineageNode } from "../lineage";
import type {
  ChatHistoryItem,
  ChatScript,
  CurrentProject,
  DbtFile,
  OrgSettings,
  ProjectSummary,
} from "../models";

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
