import { handleChat } from "./handleChat";
import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";
import type { ThreadEventPersister } from "./threadPersister";

interface Env {
  GROQ_API_KEY: string;
  /**
   * Base URL for the auth-proxy that fronts backend tool dispatchers.
   * Required: tool dispatchers cannot reach the backend without it. Threaded
   * through from `process.env.AUTH_PROXY_URL` at startup (the entrypoint
   * fails fast if unset).
   */
  AUTH_PROXY_URL: string;
  /**
   * Sampling temperature for the Groq model (default 0.3). Threaded through
   * from `process.env.GROQ_TEMPERATURE` at startup; the dataset-layer
   * integration harness pins this to 0 for determinism.
   */
  GROQ_TEMPERATURE?: number;
  /**
   * Per-channel reflect-only directive log (ADR-015 / dc-x3y.2.2 / F.3).
   * The agent's startup picks the adapter via `selectPresentationStateLog`
   * (Redis-backed when REDIS_URL is set, in-process Map otherwise) and
   * threads the same instance through here AND into the
   * `createPresentationStateRoutes` mount, so chat writes and endpoint reads
   * share storage. When omitted in tests, falls back to the in-process Map
   * singleton.
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
