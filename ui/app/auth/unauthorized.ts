// Global 401 recovery. A 401 from ANY authed surface (/api/* or /ui-state/*) means
// the session is dead — the credential cookie lapsed (e.g. the access token aged
// past its TTL while the tab idled) even though the JS-readable `session=1` flag
// lingered. Without this the onboarding gate spins forever on "Checking your
// session…" because its probe never gets a definitive answer.
//
// Recovery: clear the stale flag (so hasSession() reads false and /login won't
// bounce back into the app), then navigate to /login — which in workos mode hands
// off to WorkOS for a silent re-auth (SSO still alive) or a fresh login. The
// once() latch makes "exactly ONE navigation per burst of concurrent 401s"
// declarative rather than a hand-rolled boolean flag.
import { once } from "./once";
import { clearSessionFlag } from "./tokenStorage";

const recover = once(() => {
  try {
    clearSessionFlag();
  } catch {
    // ignore — best-effort
  }
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
});

export function handleUnauthorized(): void {
  recover.run();
}

/** Test seam: reset the one-shot guard between cases. */
export function _resetUnauthorizedForTests(): void {
  recover.reset();
}
