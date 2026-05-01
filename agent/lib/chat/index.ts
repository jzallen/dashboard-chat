import { handleChat } from "./handleChat";
import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";
import type { ThreadEventPersister } from "./threadPersister";

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
  /**
   * DomainEvent persister selected at startup by `selectThreadPersister`
   * (Epic F.2 — ADR-017). When omitted, `handleChat` falls back to
   * `noopThreadPersister`, preserving Phase 1 behavior in tests.
   */
  threadPersister?: ThreadEventPersister;
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
