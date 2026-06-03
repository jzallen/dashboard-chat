/**
 * Fixture-backed CatalogSource — implements the catalog's data port over the
 * mock `DC` catalog in data.js. This is the single boundary where data.js's
 * still-untyped structure is asserted, and (during the brownfield transition)
 * the SOLE importer of data.js: every other module reaches catalog data through
 * the `catalog` exported here, keeping src/lib pure and source-agnostic.
 *
 * Swap this module for an HTTP-backed CatalogSource when the catalog comes from
 * the backend instead of a fixture — nothing downstream changes.
 */
import {
  type CatalogSource,
  type ChatHistoryItem,
  type ChatScript,
  createDataCatalog,
  type CurrentProject,
  type DbtFile,
  type OrgSettings,
  type ProjectSummary,
} from "../lib/catalog";
import type { AuditEntry, Edge, LineageNode } from "../lib/graph";
import { DC } from "./data.js";

/**
 * data.js is plain JS; assert the shapes this adapter reads. Typing data.js
 * itself is a later extraction — until then this `as unknown as` is the single
 * boundary where the fixture's structure is pinned down.
 */
const fixture = DC as unknown as {
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
};

const fixtureSource: CatalogSource = {
  getProjects: () => fixture.PROJECTS,
  getCurrentProject: () => fixture.PROJECT,
  getOrg: () => fixture.ORG,
  getRecents: () => fixture.RECENTS,
  getAllChats: () => fixture.ALL_CHATS,
  getNodes: () => fixture.NODES,
  getEdges: () => fixture.EDGES,
  getAudit: () => fixture.AUDIT,
  getChatScript: () => fixture.CHAT_SCRIPT,
  getDbtFiles: () => fixture.DBT_FILES,
};

/** The application catalog, backed by the data.js fixture. */
export const catalog = createDataCatalog(fixtureSource);

/**
 * Temporary bridge: the composition root still publishes `DC` as a global for
 * the not-yet-migrated prototype reads (app/chat/detail). Re-export it here so
 * fixtureSource stays the only module that imports data.js during the
 * transition. Removed once those reads move onto `catalog` (Stage B).
 */
export { DC };
