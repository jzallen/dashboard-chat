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
  getProjects(): ProjectSummary[];
  getCurrentProject(): CurrentProject;
  getOrg(): OrgSettings;
  getRecents(): ChatHistoryItem[];
  getAllChats(): ChatHistoryItem[];
  getNodes(): Record<string, LineageNode>;
  getEdges(): Edge[];
  getAudit(): Record<string, AuditEntry[]>;
  getChatScript(): ChatScript;
  getDbtFiles(): DbtFile[];
}

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
