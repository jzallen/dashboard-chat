// Framework-mode route — `/` (index) AND `/chat/:channelId`.
//
// ADR-046 MR-4: the server-side `loader` reads the `sessionChat` REGION off the
// ONE `/state` document so the chat surface renders the welcome / session list /
// resumed transcript on first paint (no client-side roundtrip).
//
// For `/chat/:channelId` the loader sends an `open_deep_link` event (the standalone
// /open-deep-link route collapsed onto the single write surface) carrying the
// session id as `intent_session_id` (the event-payload key still uses the legacy
// prefix — its rename is a deferred follow-up to MR-D) so the actor drives
// project-context → project_ready → session-chat → loading_session_list →
// resuming_session before responding. The event response IS the settled document.
// Inside ui-state the wish lands in pending_resume_session_id (the renamed
// session-chat ctx field post-MR-D). Per US-205 Example 1 the transcript + dataset
// chip are visible on the SAME first paint.
//
// For `/` (index) the loader reads the current sessionChat region so the FE renders
// whatever state Maya was last in (session_list_loaded / session_active / etc).
//
// US-206 / DWD-10: the region surfaces the `session_welcome` state and the
// `pending_first_message` context field (consumed below by ChatLoaderData).
// Composer-state preservation across `error_recoverable → retry_clicked` is
// anchored on React's component-local `useState` per app-arch §6.4 — no new
// abstraction is required at the route level. A future MR rewires ChatView's submit
// handler to dispatch `first_message_sent` and to await the document's
// `regions.sessionChat.context.session_id` before POSTing the chat turn to the
// agent.

import type { LoaderFunctionArgs } from "react-router";

import { ChatView } from "../../src/ui/components/ChatView";
import { fetchStateDocument, postStateEvent } from "../lib/ui-state-client";

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
   *  link to ui-state so the orchestrator drives resume before paint.
   *  Read from the projection's `pending_resume_session_id` (post-MR-D
   *  the projection holds the click-or-deeplink-captured target in this
   *  unified field). Falls back to the URL channelId when the projection
   *  read raced or failed. */
  pending_resume_session_id: string | null;
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
  // ADR-046 MR-4: identity is header-derived (auth-proxy injects X-User-Id from
  // the forwarded Bearer). The deep-link is now an ordinary `open_deep_link` event
  // on the single write surface — the standalone `/open-deep-link` route collapsed.
  const channelId = (params.channelId as string | undefined) ?? null;

  try {
    let document = null;
    // Deep-link path: /chat/:channelId — send `open_deep_link` so the actor
    // re-resolves through resolving_initial_scope; the event response IS the
    // settled document (no second read). The payload key `intent_session_id`
    // is the wire surface — its rename to `deeplink_session_id` is a deferred
    // follow-up to MR-D.
    if (channelId) {
      try {
        document = await postStateEvent(request, {
          type: "open_deep_link",
          payload: { intent_session_id: channelId },
        });
      } catch {
        // Defensive — the GET /state read below still surfaces whatever state
        // is currently visible (e.g. session_list_loaded if the deep link
        // resolved to a deleted session).
      }
    }
    // Index path (or a deep-link that errored): read the current document.
    if (!document) {
      document = await fetchStateDocument(request);
    }
    const sessionChat = document.regions.sessionChat;
    const ctx = sessionChat.context;
    // Project on the sessionChat region lives on the shared `project: { id, name }`
    // field after the audit §9 Q3 collapse — populated by
    // `project_context_inherited` with the same id/name projectContext settled on.
    // The single authoritative scope lives at the document's top level.
    return {
      org_id: document.active_scope.org_id,
      project_id: ctx.project.id ?? null,
      project_name: ctx.project.name ?? null,
      session_id: ctx.session_id ?? null,
      state: sessionChat.state,
      transcript: ctx.transcript ?? [],
      resource: ctx.resource ?? { type: null, id: null },
      session_dataset_unavailable: Boolean(ctx.session_dataset_unavailable),
      pending_resume_session_id:
        channelId ?? ctx.pending_resume_session_id ?? null,
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
      pending_resume_session_id: channelId,
      pending_first_message: "",
    };
  }
}

export default ChatView;
