/* /logout — a navigable logout. Visiting this route runs the full logout flow
   (clear ui-state → drop the auth-proxy session/cookies → follow the WorkOS
   end-session url), the same action the Topbar "Log out" button invokes.
   logout() itself navigates the browser away on completion. */
import { useEffect, useRef } from "react";

import { logout } from "../auth/session";

export default function LogoutRoute() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void logout();
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "16px/1 system-ui,sans-serif",
      }}
    >
      <p>Signing out…</p>
    </main>
  );
}
