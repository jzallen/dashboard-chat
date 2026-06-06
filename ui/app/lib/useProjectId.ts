/* The current project id, read off the `/project/:projectId` path segment. The
   URL is the source of truth (a project switch is a route change). Returns
   undefined on the global routes (/, /org, /query-engines) — callers there
   already tolerate it (the Topbar guards). */
import { useParams } from "react-router";

export function useProjectId(): string | undefined {
  return useParams().projectId;
}
