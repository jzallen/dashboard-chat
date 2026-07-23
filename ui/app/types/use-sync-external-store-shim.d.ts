/**
 * Ambient types for the `use-sync-external-store/with-selector` shim, which
 * ships no declarations. Mirrors the React-owned `useSyncExternalStoreWithSelector`
 * signature the selector-based catalog subscription (`useCatalogWithSelector`) builds
 * on. Kept local rather than pulling a `@types/*` dev dependency for one function.
 */
declare module "use-sync-external-store/with-selector" {
  export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot: undefined | null | (() => Snapshot),
    selector: (snapshot: Snapshot) => Selection,
    isEqual?: (a: Selection, b: Selection) => boolean,
  ): Selection;
}
