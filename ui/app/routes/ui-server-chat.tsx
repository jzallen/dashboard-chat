// /ui-server/chat — a resource route (action only, no component): the ui/ server-side
// broker that relays the agent's chat SSE stream straight back to the client.
//
// The SSE RELAY is an UN-BUFFERED PASSTHROUGH (DWD-3): the action POSTs to agent
// /worker/chat via agent-client (forwarding the inbound user credential), then
// returns `new Response(upstream.body, …)` — the upstream ReadableStream is piped
// straight back. The server NEVER reads or parses the SSE body; frame parsing
// stays CLIENT-SIDE (app/lib/chat-stream.ts). This keeps long-lived turns
// streaming incrementally with no extra buffering or unbounded memory on the
// server. A non-2xx upstream (e.g. auth-proxy 401) passes through unchanged so the
// client can react / the slice can roll back cleanly.
//
// See docs/feature/ssr-ui-server-gateway/distill/roadmap.json step 4.
import type { ActionFunctionArgs } from "react-router";

import { agentFetch } from "../lib/agent-client";

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  // The request body (messages + dataset/project context) is small JSON — reading
  // it to forward is fine; it is the RESPONSE that must stream un-buffered.
  const body = await request.text();
  const contentType = request.headers.get("content-type") ?? "application/json";

  const upstream = await agentFetch(request, "/chat", {
    method: "POST",
    body,
    headers: { "content-type": contentType },
    // No timeoutMs: a chat turn is long-lived; an abort would truncate it.
  });

  // Preserve the SSE content-type (and nothing else) and pipe the body straight
  // back. Do NOT await/read upstream.body.
  const headers = new Headers();
  const upstreamContentType = upstream.headers.get("content-type");
  if (upstreamContentType) headers.set("content-type", upstreamContentType);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
