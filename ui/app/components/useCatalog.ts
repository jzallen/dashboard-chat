/**
 * The catalog composition point — this is where the app decides which
 * CatalogSource backs the catalog. Today it pairs the bundled `fixtureSource`
 * with `createDataCatalog`; swap that one argument for an HTTP source to point
 * the whole app at the backend, with nothing else changing.
 *
 * Two ways to subscribe a React component to the catalog's mutations, both over
 * the same reactive store:
 *
 *   - useCatalogWithSelector(selector) — the granular path: projects a SLICE off the
 *     immutable CatalogState and re-renders only when that slice changes, so an
 *     unrelated commit (e.g. a single audit toggle) skips the component.
 *   - useCatalog() — the coarse back-compat path: returns the opaque store
 *     version, re-rendering on EVERY commit. Read lineage data off the catalog
 *     methods and use the version as a memo/effect dependency.
 *
 * Components reach the catalog instance through useCatalogFromContext() (an injected
 * abstraction) rather than the raw `catalog` binding; CatalogProvider mounts the
 * module singleton as its default so migration is incremental. The catalog owns
 * the rename/archive/restore/live-add working state and bumps a version counter
 * after every mutation; the internal LineageGraph is never exposed mutably.
 */
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import {
  type AuditEntry,
  type CatalogSource,
  type CatalogState,
  type ChatHistoryItem,
  createDataCatalog,
  type DataCatalog,
  type DbtFile,
  type Edge,
  fixtureSource,
  type LineageNode,
  metadataApiSource,
  type OrgSettings,
  type PartialCatalogSource,
  type ProjectSummary,
  type SourceUpload,
} from "../catalog";
import type { ColdStorageRecord } from "../catalog/lineageGraph";

/**
 * The application catalog — a live ESM binding, assigned by {@link initCatalog}
 * before the app mounts. The catalog composes the backend `metadataApiSource`
 * (primary, project reads) over the bundled `fixtureSource` (complete fallback),
 * so the app renders instantly on fixtures and the project picker updates to real
 * backend projects a beat later. No module-scope code reads `catalog`, so the
 * deferred assignment is safe.
 */
export let catalog: DataCatalog;

/**
 * The currently scoped project id (the `/project/:projectId` path segment). The
 * backend source reads it via the injected `getProjectId` getter, so the catalog
 * stays router-free. {@link selectProject} sets it and re-scopes the catalog; the
 * `/project/:projectId` layout loader is the single caller. `undefined` before
 * the first paint (the source falls back to the first project until then).
 */
let scopedProjectId: string | undefined;

/**
 * Construct and install the application catalog. The root clientLoader awaits this
 * before the route tree renders, so `catalog` is set before any component reads it.
 * Token + scoped-project getters are injected, keeping the catalog auth- and
 * router-decoupled.
 */
export async function initCatalog(): Promise<void> {
  // Idempotent: the catalog is a one-time session bootstrap. Reassigning it
  // mid-session would rebuild from the fixture seed and drop the live scope,
  // working state, and subscriptions — so a second call is a no-op.
  if (catalog) return;
  catalog = await createDataCatalog(
    // Auth rides the httpOnly cookie now; the catalog can neither read nor
    // forward the token, so getToken yields null (no Bearer header is ever
    // built). The dep is kept to preserve metadataApiSource's interface.
    metadataApiSource({
      getToken: () => null,
      getProjectId: () => scopedProjectId,
    }),
    fixtureSource,
  );
}

/**
 * Re-scope the session catalog to a project: set the module-level scoped pid
 * (so the backend source's next reads target it) THEN delegate to the catalog's
 * own re-scope command. Called by the `/project/:projectId` layout clientLoader
 * on every project change. The single `catalog` instance is preserved so the
 * persistent chrome's subscriptions stay valid.
 */
export function selectProject(projectId: string): Promise<void> {
  scopedProjectId = projectId;
  return catalog.selectProject(projectId);
}

/**
 * Re-fetch the org-global payloads (projects/org/chatScript). The authenticated
 * app shell calls this on entry so real backend projects replace the fixture
 * seed before the home redirect picks a project — it must NOT run unauthenticated
 * (the caller gates on a token), so the login round-trip fires no 401s.
 */
export function refreshOrgGlobal(): Promise<void> {
  return catalog.refreshOrgGlobal();
}

/**
 * Seed the org-global payloads (projects + org) from the app-shell server
 * loader's data — the module entry point the shell calls with `useLoaderData()`,
 * mirroring how {@link refreshOrgGlobal} delegates. Commits already-fetched
 * values (no round-trip), so real projects replace the fixture seed straight off
 * the hydrated payload.
 */
export function seedOrgGlobal(
  projects: ProjectSummary[],
  org: OrgSettings,
): void {
  catalog.seedOrgGlobal(projects, org);
}

/**
 * Seed the project-scoped payloads from the `/project/:projectId` server loader's
 * data — the module entry point the layout calls with `useLoaderData()`,
 * mirroring how {@link seedOrgGlobal} commits already-fetched values (no
 * round-trip). Commits the SSR'd lineage graph, audit, sessions, dbt files, and
 * source uploads into the catalog snapshot for the scoped pid, so the catalog
 * reads real project data straight off the hydrated payload.
 *
 * The parameter is structurally the route's `ProjectScopedData`; it is typed
 * inline here (rather than imported) to keep the component→catalog dependency
 * one-directional.
 */
export function seedProjectScoped(data: {
  projectId: string;
  nodes: Record<string, LineageNode>;
  edges: Edge[];
  audit: Record<string, AuditEntry[]>;
  dbtFiles: DbtFile[];
  chats: ChatHistoryItem[];
  recents: ChatHistoryItem[];
  sourceUploads: Record<string, SourceUpload[]>;
  coldRecords?: ColdStorageRecord[];
}): void {
  // `sourceUploads` is carried on the loader payload for shape parity but is not
  // part of the catalog snapshot — uploads are read on demand per source — so it
  // is intentionally not committed here.
  catalog.seedProjectScoped(data);
}

/** The scoped pid the test seam exposes so a primary can read it (mirrors the
 * production `getProjectId` injection). Tests that drive `selectProject` will
 * have this updated; primaries that ignore scope can disregard it. */
export function currentScopedProjectIdForTest(): string | undefined {
  return scopedProjectId;
}

/** The primary a route/nav test installed, so {@link loadTestScope} can read the
 * project-scoped payloads the production server loader would fetch. Not used by
 * the app. */
let testPrimary: PartialCatalogSource | undefined;

/**
 * Install a catalog composed from explicit sources — the seam route/nav tests
 * use to seed a known fixture catalog (and exercise the async deep-link
 * resolver) without the real backend `metadataApiSource`. Resets the scoped-pid
 * holder so each test starts unscoped. Not used by the app.
 */
export async function installCatalogForTest(
  primary: PartialCatalogSource,
  fallback: CatalogSource,
): Promise<void> {
  scopedProjectId = undefined;
  testPrimary = primary;
  catalog = await createDataCatalog(primary, fallback);
}

/**
 * Route/nav test seam standing in for the production `/project/:projectId` server
 * loader: it reads the installed test primary's project-scoped payloads and
 * commits them via {@link seedProjectScoped}, just as the real loader fetches
 * them through `apiFetch` and the component seeds `useLoaderData()`. Called
 * fire-and-forget from the test route tree's layout loader so the route renders
 * on the current snapshot first (the bounded-pending skeleton) and the scoped
 * payloads commit reactively a beat later — the async deep-link resolution these
 * tests exercise. A superseded scope's late resolution is dropped.
 */
export async function loadTestScope(projectId: string): Promise<void> {
  scopedProjectId = projectId;
  const p = testPrimary;
  if (!p) return;
  // No backend lineage getters → keep the seeded fallback graph, as the SSR
  // loader carries no scoped payload for a fixture-only catalog.
  if (!p.getNodes || !p.getEdges || !p.getAudit) return;
  let nodes: Record<string, LineageNode>;
  let edges: Edge[];
  let audit: Record<string, AuditEntry[]>;
  try {
    [nodes, edges, audit] = await Promise.all([
      p.getNodes ? p.getNodes() : Promise.resolve({}),
      p.getEdges ? p.getEdges() : Promise.resolve([] as Edge[]),
      p.getAudit ? p.getAudit() : Promise.resolve({}),
    ]);
  } catch {
    return; // a failed lineage read keeps the seeded fallback (no blank canvas)
  }
  const [recents, chats, dbtFiles] = await Promise.all([
    (p.getRecents ? p.getRecents() : Promise.resolve([])).catch(
      () => [] as ChatHistoryItem[],
    ),
    (p.getAllChats ? p.getAllChats() : Promise.resolve([])).catch(
      () => [] as ChatHistoryItem[],
    ),
    (p.getDbtFiles ? p.getDbtFiles() : Promise.resolve([])).catch(
      () => [] as DbtFile[],
    ),
  ]);
  if (scopedProjectId !== projectId) return; // a later navigation superseded us
  seedProjectScoped({
    projectId,
    nodes,
    edges,
    audit,
    dbtFiles,
    chats,
    recents,
    sourceUploads: {},
  });
}

/** Subscribe a component to catalog mutations; returns the store version. */
export function useCatalog(): number {
  const instance = useCatalogFromContext();
  return useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
    instance.getSnapshot,
  );
}

/**
 * The React context carrying the catalog instance. Its default is the module
 * singleton (read lazily via {@link resolveCatalog}) so a component rendered
 * outside a {@link CatalogProvider} still reaches the app's one catalog — the
 * provider is a seam for injecting a test/alternate instance, not a hard
 * requirement. `null` marks "no explicit provider", distinct from a provided
 * instance.
 */
const CatalogContext = createContext<DataCatalog | null>(null);

/** The catalog a consumer sees: the explicitly provided instance, else the
 *  module singleton assigned by {@link initCatalog} / {@link installCatalogForTest}. */
function resolveCatalog(provided: DataCatalog | null): DataCatalog {
  return provided ?? catalog;
}

/**
 * Provide a catalog instance to the subtree. Mounted high in the app tree with
 * the module singleton as its default value, so components depend on the
 * injected {@link useCatalogFromContext} abstraction rather than the raw `catalog`
 * binding. Tests can wrap a subtree to inject an explicit instance.
 */
export function CatalogProvider({
  value,
  children,
}: {
  value?: DataCatalog;
  children: ReactNode;
}): ReactNode {
  return createElement(
    CatalogContext.Provider,
    { value: value ?? null },
    children,
  );
}

/** The catalog instance for the current subtree — the injected abstraction the
 *  presentation depends on instead of the raw `catalog` binding. Falls back to
 *  the module singleton when no provider is mounted. */
export function useCatalogFromContext(): DataCatalog {
  return resolveCatalog(useContext(CatalogContext));
}

/**
 * Subscribe to a SLICE of the catalog state, re-rendering only when that slice
 * changes. Built on `useSyncExternalStoreWithSelector` over the store's
 * immutable {@link CatalogState}: the selector projects the slice a component
 * reads, and `isEqual` (defaulting to `Object.is`) decides whether a commit
 * that produced a new state actually changed this slice — so toggling one audit
 * entry no longer re-renders every subscriber. Replaces the opaque-`version`
 * {@link useCatalog} for granular reads.
 */
export function useCatalogWithSelector<T>(
  selector: (state: CatalogState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const instance = useCatalogFromContext();
  return useSyncExternalStoreWithSelector(
    instance.subscribe,
    instance.getStateSnapshot,
    instance.getStateSnapshot,
    selector,
    isEqual,
  );
}
