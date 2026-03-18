/**
 * Projects API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

export type { DatasetSparse } from "./datasets";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  datasets?: import("./datasets").DatasetSparse[];
}
