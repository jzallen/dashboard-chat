// MR-2: clientLoader-only opt-out per DWD-3. The chat surface streams SSE from
// the agent (ADR-015 routes /api/channels/:id/presentation-state directly to
// agent), so server-side data prefetch has no meaning here. clientLoader runs
// ONLY in the browser; the SSR pass produces a library-mode HTML shell.
import type { ClientLoaderFunctionArgs } from "react-router";

import { ChatView } from "../../src/ui/components/ChatView";

export async function clientLoader(_args: ClientLoaderFunctionArgs) {
  // No server prefetch — chat data is streamed client-side via SSE.
  // Returning null is the canonical "no client-loader data" shape.
  return null;
}

export default ChatView;
