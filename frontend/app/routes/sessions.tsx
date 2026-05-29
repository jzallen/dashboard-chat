// Framework-mode route — `/sessions`.
//
// ADR-046 MR-4: the loader reads the `projectContext` + `sessionChat` REGIONS off
// the ONE `/state` document (one GET instead of two per-machine projection reads).
// The projectContext region carries the active project (Maya needs to see
// "showing sessions for Q4 Analytics"); the sessionChat region carries the actual
// `session_list` array sorted DESC by `last_active_at`.
//
// Per OQ-J002-5 / journey YAML's `session.list` shared artifact, the full-
// list page is paginated client-side after the first page is loader-served.

import type { LoaderFunctionArgs } from "react-router";

import { SessionList } from "../../src/ui/components/SessionList";
import { fetchStateDocument } from "../lib/ui-state-client";

export interface SessionListItem {
  id: string;
  title: string | null;
  last_active_at: string;
  active_dataset_id: string | null;
}

export interface SessionsLoaderData {
  org_id: string;
  project_id: string | null;
  project_name: string | null;
  sessions: SessionListItem[];
  next_cursor: string | null;
  has_more: boolean;
}

export async function loader({
  request,
}: LoaderFunctionArgs): Promise<SessionsLoaderData> {
  // ADR-046 MR-4: one GET /state carries every region. Identity is
  // header-derived (auth-proxy injects X-User-Id from the forwarded Bearer).
  try {
    const document = await fetchStateDocument(request);
    const projectCtx = document.regions.projectContext.context;
    const sessionCtx = document.regions.sessionChat.context;
    // Project state on both regions converges on `project: { id, name }`
    // (audit §9 Q3 / MR-H field collapse). The sessionChat → projectContext
    // fallback covers the bootstrap race where projectContext has settled but
    // sessionChat has not yet received `project_context_inherited`. The single
    // authoritative scope lives at the document's top level.
    return {
      org_id: document.active_scope.org_id,
      project_id: sessionCtx.project.id ?? projectCtx.project.id ?? null,
      project_name: sessionCtx.project.name ?? projectCtx.project.name ?? null,
      sessions: sessionCtx.session_list ?? [],
      next_cursor: sessionCtx.session_list_next_cursor ?? null,
      has_more: sessionCtx.session_list_has_more ?? false,
    };
  } catch (err) {
    if (err instanceof Response && err.status === 504) throw err;
    return {
      org_id: "",
      project_id: null,
      project_name: null,
      sessions: [],
      next_cursor: null,
      has_more: false,
    };
  }
}

export default SessionList;
