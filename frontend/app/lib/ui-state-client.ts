// Request-scoped fetch helper for loaders that need to call ui-state via auth-proxy.
// DWD-1: loaders forward the inbound Bearer token via the request's Authorization header
// rather than reaching into client-only state (useAuth). Dormant at MR-0 — no loader
// references this helper yet. Becomes live in the first per-route migration MR.

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";

export function uiStateClient(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  return {
    async getProjection(machine: string, flowId?: string) {
      const url = new URL(`/ui-state/flow/${machine}/projection`, AUTH_PROXY_URL);
      if (flowId) url.searchParams.set("flow_id", flowId);
      const res = await fetch(url, { headers: { authorization: authHeader } });
      if (!res.ok) throw new Response(`ui-state ${res.status}`, { status: res.status });
      return res.json();
    },
  };
}
