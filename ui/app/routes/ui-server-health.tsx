// /ui-server/health — a resource route (loader only, no component). The Phase-0
// auth-hop proof for the SSR ui-server gateway: it proves the full chain
//
//   browser -> RRv7 server (this loader) -> auth-proxy:1042 -> agent /health
//
// works server-side with the inbound user credential forwarded, BEFORE the chat
// relay depends on it. See docs/feature/ssr-ui-server-gateway/distill/roadmap.json
// step 3.
import type { LoaderFunctionArgs } from "react-router";

import { agentFetch } from "../lib/agent-client";

/** 5s is plenty for a health ping; unlike the chat relay this is not long-lived. */
const HEALTH_TIMEOUT_MS = 5000;

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await agentFetch(request, "/health", {
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
  } catch {
    return Response.json({ status: "unreachable" }, { status: 502 });
  }
  const body = await upstream
    .json()
    .catch(() => ({ status: upstream.ok ? "ok" : "error" }));
  return Response.json(body, { status: upstream.ok ? 200 : 502 });
}
