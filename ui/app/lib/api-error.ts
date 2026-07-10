/**
 * api-error — the canonical home of {@link ApiError}, the HTTP failure the
 * gateway adapters raise on a non-2xx answer from the backend.
 *
 * This module is the RELOCATION SEAM for retiring the browser catalog transport:
 * `ApiError` is moving OFF `catalog/dataSources/backendClient` (a browser-direct
 * `/api` client) onto a transport-agnostic home so it survives the deletion of
 * that client. Until the importers are rewired, `backendClient` still exports its
 * own `ApiError`; once every call site imports from here, `backendClient` and its
 * copy of the class are removed.
 *
 * The contract is unchanged from the backendClient definition it supersedes: a
 * non-2xx HTTP failure carrying the response `status` and the parsed error `body`
 * (or `null` when the body is not JSON). It extends `Error` and KEEPS the original
 * message text, so existing call sites — which read `err.message` and rely on
 * `instanceof Error` — keep working. Definitive-answer callers (the onboarding
 * driver) read `.status`/`.body` to map an HTTP answer to a closed-union outcome.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
