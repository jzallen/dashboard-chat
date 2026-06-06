/* The current project id, read off the ?project= query with a fallback to the
   catalog's first project. The URL is the source of truth (a project switch
   replaces it); the fallback is the interim while backend projects revalidate —
   keyed off the catalog version so it settles after the SWR commit. */
import { useSearchParams } from "react-router";

import { catalog, useCatalog } from "../../src/app/useCatalog";

export function useProjectId(): string | undefined {
  const [params] = useSearchParams();
  // Re-read the fallback after every catalog commit (projects revalidate).
  useCatalog();
  return params.get("project") ?? catalog.listProjects()[0]?.id;
}
