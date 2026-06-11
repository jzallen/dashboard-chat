/* /auth/callback — exchange the auth code for a token, then land on the
   workspace. The replace navigation scrubs ?code=&state= from history.
   dev: the code is dev-auth-code with no state. workos: WorkOS echoes
   ?code=…&state=…; the state is forwarded so the auth-proxy's CSRF check passes. */
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { handleCallback } from "../auth/bootstrap";
import { createLogger } from "../lib/log";

const log = createLogger("auth");

export default function AuthCallbackRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    const code = searchParams.get("code");
    if (!code) {
      navigate("/login", { replace: true });
      return;
    }
    // workos echoes the CSRF state alongside the code; dev has none (undefined).
    const state = searchParams.get("state") ?? undefined;
    calledRef.current = true;
    handleCallback(code, state)
      .then(() => {
        log.info("callback.ok");
        navigate("/", { replace: true });
      })
      .catch((err) => {
        log.error("callback.failed", { err: String(err) });
        navigate("/login", { replace: true });
      });
  }, [searchParams, navigate]);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
      }}
    >
      <p>Completing login…</p>
    </div>
  );
}
