/* /login — the sign-in route (ADR-050 §d mode discovery). On mount it fetches the
   memoized fetchAuthConfig(); until the mode is known NO sign-in affordance
   renders (a neutral waiting surface — never a flash of a dev button in workos
   mode). mode==='dev' → the "Sign in (dev)" button; mode==='workos' → a plain
   "Sign in" button. Both onClick invoke the UNCHANGED login(). Already
   authenticated → straight to the workspace. */
import { useEffect, useState } from "react";
import { Navigate } from "react-router";

import { type AuthConfig, fetchAuthConfig, login } from "../auth/bootstrap";
import { hasSession } from "../auth/tokenStorage";
import { createLogger } from "../lib/log";

const log = createLogger("auth");

export default function LoginRoute() {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<AuthConfig["mode"] | null>(null);

  const authenticated = hasSession();

  useEffect(() => {
    if (authenticated) return;
    let cancelled = false;
    fetchAuthConfig()
      .then((config) => {
        if (!cancelled) setMode(config.mode);
      })
      .catch((err) => {
        log.error("login.config.failed", { err: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (authenticated) return <Navigate to="/" replace />;

  const onSignIn = () => {
    setBusy(true);
    log.info("login.start");
    login().catch((err) => {
      setBusy(false);
      log.error("login.failed", { err: String(err) });
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {mode === null ? null : (
        <button
          disabled={busy}
          onClick={onSignIn}
          style={{
            font: "600 18px/1 system-ui,sans-serif",
            padding: "14px 28px",
            cursor: "pointer",
            border: "3px solid #000",
            borderRadius: 10,
            background: "#ffe14d",
            boxShadow: "4px 4px 0 #000",
          }}
        >
          {busy
            ? "Redirecting…"
            : mode === "dev"
              ? "Sign in (dev)"
              : "Sign in"}
        </button>
      )}
    </div>
  );
}
