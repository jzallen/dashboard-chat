// Framework-mode route — `/` (index) AND `/chat/:channelId`.
//
// MR-2 (DWD-4 + DWD-9): adds a server-side `loader` that resolves the
// session-chat projection so the chat surface renders the welcome / session
// list / resumed transcript on first paint (no client-side roundtrip).
//
// For `/chat/:channelId` the loader posts an `open_deep_link` with
// `intent_session_id = params.channelId` so the orchestrator drives
// project-context → project_ready → session-chat → loading_session_list →
// resuming_session before the loader returns. Per US-205 Example 1 the
// transcript + dataset chip are visible on the SAME first paint.
//
// For `/` (index) the loader returns the current session-chat projection so
// the FE renders whatever state Maya was last in (session_list_loaded /
// session_active / etc).
//
// MR-3 (US-206 / DWD-10): the loader surfaces the new `session_welcome`
// state and the `pending_first_message` context field via the projection
// envelope (consumed below by ChatLoaderData). Composer-state preservation
// across `error_recoverable → retry_clicked` is anchored on React's
// component-local `useState` per app-arch §6.4 — no new abstraction is
// required at the route level. A future MR rewires ChatView's submit
// handler to dispatch `first_message_sent` against the session-chat machine
// and to await `projection.session_id` (set by the machine's
// createSessionEagerly invoke) before POSTing the chat turn to the agent;
// MR-3 lands only the machine + projection substrate that wiring depends on.

import type { LoaderFunctionArgs } from "react-router";

import { ChatView } from "../../src/ui/components/ChatView";
import {
  SESSION_CHAT_MACHINE,
  uiStateClient,
} from "../lib/ui-state-client";

const DEFAULT_PRINCIPAL_ID = "dev-user-001";

export interface ChatLoaderData {
  org_id: string;
  project_id: string | null;
  project_name: string | null;
  session_id: string | null;
  state: string;
  transcript: Array<{
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    ts: string;
  }>;
  resource: { type: "dataset" | "view" | "report" | null; id: string | null };
  session_dataset_unavailable: boolean;
  /** When the URL carried /chat/:channelId, the loader forwards the deep
   *  link to ui-state so the orchestrator drives resume before paint. */
  intent_session_id: string | null;
  /** MR-3 (US-206 / app-arch §6.4) — preserved across the
   *  `error_recoverable → retry_clicked` boundary by the session-chat
   *  machine. Surfaced here so the future first-message-handler rewire can
   *  hydrate the composer with its prior value on retry. */
  pending_first_message: string;
}

export async function loader({
  request,
  params,
}: LoaderFunctionArgs): Promise<ChatLoaderData> {
  const principalId = DEFAULT_PRINCIPAL_ID;
  const sessionChatFlowId = `${SESSION_CHAT_MACHINE}:${principalId}`;
  const client = uiStateClient(request);
  const channelId = (params.channelId as string | undefined) ?? null;

  try {
    // Deep-link path: /chat/:channelId — push the intent_session_id through
    // the orchestrator's project-context machine, which forwards it to
    // session-chat via the `project_ready` broadcast hook (DESIGN §3.4).
    if (channelId) {
      try {
        await client.openProjectDeepLink(principalId, {
          intent_session_id: channelId,
        });
      } catch {
        // Defensive — projection read below still surfaces whatever state
        // is currently visible (e.g. session_list_loaded if the deep link
        // resolved to a deleted session).
      }
    }
    const sessionChat = await client.getProjection(
      SESSION_CHAT_MACHINE,
      sessionChatFlowId,
    );
    const ctx = sessionChat.context as {
      session_chat_project_id?: string | null;
      session_chat_project_name?: string | null;
      session_id?: string | null;
      transcript?: Array<{
        id: string;
        role: "user" | "assistant" | "tool";
        content: string;
        ts: string;
      }>;
      resource?: {
        type: "dataset" | "view" | "report" | null;
        id: string | null;
      };
      session_dataset_unavailable?: boolean;
      intent_session_id?: string | null;
      pending_first_message?: string;
    };
    return {
      org_id: sessionChat.active_scope.org_id,
      project_id: ctx.session_chat_project_id ?? null,
      project_name: ctx.session_chat_project_name ?? null,
      session_id: ctx.session_id ?? null,
      state: sessionChat.state,
      transcript: ctx.transcript ?? [],
      resource: ctx.resource ?? { type: null, id: null },
      session_dataset_unavailable: Boolean(ctx.session_dataset_unavailable),
      intent_session_id: channelId ?? ctx.intent_session_id ?? null,
      pending_first_message: ctx.pending_first_message ?? "",
    };
  } catch (err) {
    if (err instanceof Response && err.status === 504) throw err;
    return {
      org_id: "",
      project_id: null,
      project_name: null,
      session_id: null,
      state: "waiting_for_project",
      transcript: [],
      resource: { type: null, id: null },
      session_dataset_unavailable: false,
      intent_session_id: channelId,
      pending_first_message: "",
    };
  }
}

export default ChatView;
