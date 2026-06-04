/**
 * Fixture-backed {@link CatalogSource} — implements the catalog's data port over
 * the mock `DC` catalog in fixtureData.js. This is the single boundary where
 * fixtureData.js's still-untyped structure is asserted, and its SOLE importer.
 *
 * Exports the source implementation, not a wired catalog: the composition layer
 * (src/app/useCatalog.ts) pairs it with {@link createDataCatalog}. Swap in an
 * HTTP-backed CatalogSource (a sibling in this folder) to repoint the catalog at
 * the backend — nothing downstream changes.
 */
import { DC } from "./fixtureData.js";
import type { CatalogSource, RawCatalog } from "./source";

/**
 * fixtureData.js is plain JS; assert the shapes this adapter reads. Typing it
 * is a later extraction — until then this `as unknown as` is the single boundary
 * where the fixture's structure is pinned down.
 */
const fixture = DC as unknown as RawCatalog;

/** The bundled fixture source — serves the mock catalog through the port. */
export const fixtureSource: CatalogSource = {
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
