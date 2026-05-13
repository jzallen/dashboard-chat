// Framework-mode route — `/sessions`.
//
// MR-2 (DWD-4 + DWD-9): adds a server-side `loader` that reads BOTH the
// project-context projection AND the session-chat projection. The
// project-context projection carries the active project (Maya needs to see
// "showing sessions for Q4 Analytics"); session-chat carries the actual
// `session_list` array sorted DESC by `last_active_at`.
//
// Per DWD-13 each machine has its OWN flow_id namespace:
//   project-context flow_id = `project-and-chat-session-management:<principal>`
//   session-chat   flow_id = `session-chat:<principal>`
//
// Per OQ-J002-5 / journey YAML's `session.list` shared artifact, the full-
// list page is paginated client-side after the first page is loader-served.

import type { LoaderFunctionArgs } from "react-router";

import { SessionList } from "../../src/ui/components/SessionList";
import {
  PROJECT_FLOW_MACHINE,
  SESSION_CHAT_MACHINE,
  uiStateClient,
} from "../lib/ui-state-client";

const DEFAULT_PRINCIPAL_ID = "dev-user-001";

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
  const principalId = DEFAULT_PRINCIPAL_ID;
  const projectFlowId = `${PROJECT_FLOW_MACHINE}:${principalId}`;
  const sessionChatFlowId = `${SESSION_CHAT_MACHINE}:${principalId}`;
  const client = uiStateClient(request);

  try {
    const [projectContext, sessionChat] = await Promise.all([
      client.getProjection(PROJECT_FLOW_MACHINE, projectFlowId),
      client.getProjection(SESSION_CHAT_MACHINE, sessionChatFlowId),
    ]);
    const projectCtx = projectContext.context as {
      project?: { id: string | null; name: string | null };
    };
    const sessionCtx = sessionChat.context as {
      session_chat_project_id?: string | null;
      session_chat_project_name?: string | null;
      session_list?: SessionListItem[];
      session_list_next_cursor?: string | null;
      session_list_has_more?: boolean;
    };
    return {
      org_id: projectContext.active_scope.org_id,
      project_id:
        sessionCtx.session_chat_project_id ?? projectCtx.project?.id ?? null,
      project_name:
        sessionCtx.session_chat_project_name ??
        projectCtx.project?.name ??
        null,
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
