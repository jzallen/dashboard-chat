/**
 * CatalogSource — the port the catalog reads through. It exposes the raw,
 * unprocessed catalog payloads; {@link createDataCatalog} (./client.ts) layers
 * the query/projection logic on top. Implement this over any backing store: a
 * fixture (src/app/fixtureSource.ts) today, an HTTP client later.
 *
 * Pure: types only, no concrete data dependency. The fixture cast lives in the
 * adapter that implements this interface, not here.
 */
import type { AuditEntry, Edge, LineageNode } from "../graph";
import type {
  ChatHistoryItem,
  ChatScript,
  CurrentProject,
  DbtFile,
  OrgSettings,
  ProjectSummary,
} from "./models";

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
