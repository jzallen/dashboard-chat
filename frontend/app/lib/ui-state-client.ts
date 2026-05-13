// Request-scoped fetch helper for loaders that need to call ui-state via auth-proxy.
// DWD-1: loaders forward the inbound Bearer token via the request's Authorization header
// rather than reaching into client-only state (useAuth).
// DD-16 (Phase 04): every fetch is bounded by a 5-second AbortController budget.
// On timeout the call rejects with a `Response(504)` so the loader's route-level
// ErrorBoundary can render an HTML fallback rather than hanging the SSR pass.

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";
const LOADER_TIMEOUT_MS = 5000;

export function uiStateClient(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  return {
    async getProjection(machine: string, flowId?: string) {
      const url = new URL(`/ui-state/flow/${machine}/projection`, AUTH_PROXY_URL);
      if (flowId) url.searchParams.set("flow_id", flowId);
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        LOADER_TIMEOUT_MS,
      );
      try {
        const res = await fetch(url, {
          headers: { authorization: authHeader },
          signal: controller.signal,
        });
        if (!res.ok)
          throw new Response(`ui-state ${res.status}`, { status: res.status });
        return res.json();
      } catch (err) {
        if (err instanceof Response) throw err;
        if (
          err instanceof Error &&
          (err.name === "AbortError" || controller.signal.aborted)
        ) {
          throw new Response("ui-state timeout", { status: 504 });
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
