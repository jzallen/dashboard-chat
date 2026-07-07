/**
 * Catalog library barrel — the public surface of app/catalog. Import the
 * factory, the {@link CatalogSource} port, and its bundled implementations from
 * here rather than reaching into individual modules.
 *
 * The catalog is an interface over a source, so the two are packaged together:
 * dataSources/ owns the port (source.ts) and its implementations (fixtureSource
 * today, an HTTP source later). Which source to use is a composition decision
 * left to the app — app/components/useCatalog.ts pairs one with createDataCatalog.
 */
export type { DataCatalog } from "./client";
export { createDataCatalog } from "./client";
export { fixtureSource } from "./dataSources/fixtureSource";
export type { MetadataApiSourceDeps } from "./dataSources/metadataApiSource";
export { metadataApiSource } from "./dataSources/metadataApiSource";
export type {
  CatalogSource,
  PartialCatalogSource,
  RawCatalog,
  SourceUpload,
} from "./dataSources/source";
export type * from "./lineage";
export { AUDIT_TAGS, LAYER_ORDER, modelKindForLayer } from "./lineage";
export type * from "./models";
