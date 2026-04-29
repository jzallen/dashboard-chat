import { handleChat } from "./handleChat";
import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";

interface Env {
  GROQ_API_KEY: string;
  /**
   * Per-channel reflect-only directive log (ADR-015 / dc-x3y.2.2). Defaults
   * to the in-process Map singleton. The same instance is exposed for the
   * agent's `GET /api/channels/{id}/presentation-state` endpoint via
   * `presentationStateLogFor(env)` so writes (chat) and reads (endpoint)
   * share the same store.
   */
  presentationStateLog?: PresentationStateLog;
}

export { handleChat } from "./handleChat";
export {
  InProcessPresentationStateLog,
  inProcessPresentationStateLog,
  noopPresentationStateLog,
  type PresentationStateLog,
  type PresentationStateLogEntry,
} from "./presentationState";

export function createChatHandler(env: Env) {
  return (request: Request) => handleChat(request, env);
}

export function presentationStateLogFor(env: Env): PresentationStateLog {
  return env.presentationStateLog ?? inProcessPresentationStateLog;
}
