/**
 * Fixture-backed {@link CatalogSource} — implements the catalog's data port over
 * the mock `DC` catalog in fixtureData.js. This is the single boundary where
 * fixtureData.js's still-untyped structure is asserted, and its SOLE importer.
 *
 * Exports the source implementation, not a wired catalog: the composition layer
 * (app/components/useCatalog.ts) pairs it with {@link createDataCatalog}. Swap in an
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

/**
 * The bundled fixture source — serves the mock catalog through the port. The
 * data is local and synchronous; each getter wraps it in `Promise.resolve(...)`
 * to satisfy the async {@link CatalogSource} contract (resolves instantly, so
 * seeding the catalog from this fallback is effectively synchronous).
 */
export const fixtureSource: CatalogSource = {
  getProjects: () => Promise.resolve(fixture.PROJECTS),
  getCurrentProject: () => Promise.resolve(fixture.PROJECT),
  getOrg: () => Promise.resolve(fixture.ORG),
  getRecents: () => Promise.resolve(fixture.RECENTS),
  getAllChats: () => Promise.resolve(fixture.ALL_CHATS),
  getNodes: () => Promise.resolve(fixture.NODES),
  getEdges: () => Promise.resolve(fixture.EDGES),
  getAudit: () => Promise.resolve(fixture.AUDIT),
  getChatScript: () => Promise.resolve(fixture.CHAT_SCRIPT),
  getDbtFiles: () => Promise.resolve(fixture.DBT_FILES),
};
