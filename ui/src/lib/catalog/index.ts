/**
 * Catalog library barrel — the public surface of src/lib/catalog. Import the
 * factory and types from here rather than reaching into individual modules.
 *
 * Pure (like the rest of src/lib): no data source is imported here. The fixture
 * adapter that wires a concrete source lives in src/app/fixtureSource.ts.
 */
export type { DataCatalog } from "./client";
export { createDataCatalog } from "./client";
export type * from "./lineage";
export { LAYER_ORDER } from "./lineage";
export type * from "./models";
export type { CatalogSource, RawCatalog } from "./source";
