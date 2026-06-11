/* SessionLifecycleProvider — the orchestrator (slice C) tying the idle tracker,
   the keep-alive beat, and auto-logout together. Gated on hasSession() so it is
   inert when signed out. Mounted high in the tree (root) so the inactivity modal
   is app-wide; useLocation() re-reads hasSession() across the client-side login
   transition (Root itself never remounts). The keep-alive/logout actions are
   injectable for tests. */
import { type ReactNode } from "react";
import { useLocation } from "react-router";

import { keepAlive as defaultKeepAlive, logout as defaultLogout } from "../auth/session";
import { hasSession } from "../auth/tokenStorage";
import { useInactivity } from "../auth/useInactivity";
import { ActivityCheckModal } from "../components/ActivityCheckModal/ActivityCheckModal";

export function SessionLifecycleProvider({
  children,
  keepAlive = defaultKeepAlive,
  logout = defaultLogout,
}: {
  children: ReactNode;
  /** Test seam: the keep-alive beat (ui-state touch + token refresh). */
  keepAlive?: () => void | Promise<void>;
  /** Test seam: the logout action (WorkOS end-session + cookie/ui-state clear). */
  logout?: () => void | Promise<void>;
}) {
  // Re-render on navigation so hasSession() reflects a just-completed login.
  useLocation();
  const authenticated = hasSession();

  const { showModal, handleContinue, handleLogout } = useInactivity({
    isAuthenticated: authenticated,
    onLogout: () => void logout(),
    onKeepAlive: () => void keepAlive(),
  });

  return (
    <>
      {children}
      <ActivityCheckModal
        isOpen={showModal}
        onContinue={handleContinue}
        onLogout={handleLogout}
      />
    </>
  );
}
