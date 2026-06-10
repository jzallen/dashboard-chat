/* StateProxyProvider — the D4 singleton seam: ONE StateProxy instance shared by
   the whole route tree (the app-shell gate and /onboarding read the SAME proxy),
   plus the ORD-4 ensureBootstrap latch.

   ensureBootstrap(): a once-latched promise that POSTs { type: "session_begin" }
   via proxy.postEvent and awaits settle. Every subsequent call — from ANY
   surface — returns the SAME promise, so exactly one session_begin fires per app
   load. Gated on hasSession(): with no session flag it is a no-op that does NOT
   latch, so a later call after the flag appears (post-login client-side
   navigation — Root never remounts, hence a latch and not a mount effect) still
   bootstraps.

   The proxy is injectable (prop) for tests; the default is one lazily-created
   module singleton. ensureBootstrap's call sites are the authenticated entry
   surfaces: the app-shell onboarding gate and /onboarding. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";

import { hasSession } from "../auth/tokenStorage";
import { createLogger } from "./log";
import { createStateProxy, type StateProxy } from "./state-proxy";

const log = createLogger("state-proxy");

export type StateProxyApi = {
  /** The one app-wide StateProxy (D4 singleton). */
  proxy: StateProxy;
  /** Idempotent session bootstrap — see module header. */
  ensureBootstrap: () => Promise<void>;
};

const StateProxyContext = createContext<StateProxyApi | null>(null);

// The lazily-created default — ONE proxy per app load, shared by every route.
let defaultProxy: StateProxy | null = null;

function defaultStateProxy(): StateProxy {
  defaultProxy ??= createStateProxy();
  return defaultProxy;
}

export function StateProxyProvider({
  proxy,
  children,
}: {
  /** Test seam: inject a proxy; defaults to the module singleton. */
  proxy?: StateProxy;
  children: ReactNode;
}) {
  const resolvedProxy = proxy ?? defaultStateProxy();
  const latch = useRef<Promise<void> | null>(null);

  const ensureBootstrap = useCallback((): Promise<void> => {
    if (latch.current) return latch.current;
    // No session flag → no-op WITHOUT latching, so a post-login call still
    // bootstraps once the flag cookie appears.
    if (!hasSession()) return Promise.resolve();
    latch.current = resolvedProxy.postEvent({ type: "session_begin" }).then(
      () => undefined,
      (error: unknown) => {
        // Stay latched — one session_begin per app load; the document stays
        // anonymous and the consuming gate handles the degraded state.
        log.error("bootstrap.session_begin.failed", { error: String(error) });
      },
    );
    return latch.current;
  }, [resolvedProxy]);

  const value = useMemo<StateProxyApi>(
    () => ({ proxy: resolvedProxy, ensureBootstrap }),
    [resolvedProxy, ensureBootstrap],
  );

  return (
    <StateProxyContext.Provider value={value}>
      {children}
    </StateProxyContext.Provider>
  );
}

export function useStateProxy(): StateProxyApi {
  const ctx = useContext(StateProxyContext);
  if (!ctx) {
    throw new Error("useStateProxy must be used within StateProxyProvider");
  }
  return ctx;
}
