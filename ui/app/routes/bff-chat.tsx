// RED scaffold (DISTILL) — replaced in DELIVER step 4.
// __SCAFFOLD__
//
// The /bff/chat resource route: the ui/ server-side broker that relays the agent
// SSE stream straight back to the client (un-buffered passthrough). See
// docs/feature/ssr-bff-gateway/distill/roadmap.json step 4.
import type { ActionFunctionArgs } from "react-router";

export async function action(_args: ActionFunctionArgs): Promise<Response> {
  throw new Error("__SCAFFOLD__ /bff/chat resource route not implemented (RED)");
}
