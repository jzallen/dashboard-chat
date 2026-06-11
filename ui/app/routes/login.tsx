/* /login — the sign-in route (ADR-050 §d mode discovery). On mount it fetches the
   memoized fetchAuthConfig(); until the mode is known NO affordance renders (a
   neutral waiting surface — never a flash of a button in workos mode).

   mode==='dev'    → the one-button "Sign in (dev)" affordance (clicking it runs
                     login(), which hands off to the dev callback).
   mode==='workos' → WorkOS *is* the sign-in page, so there is NO local button:
                     the route hands off to the WorkOS authorize url immediately
                     via login(). Only a redirect notice (and an error/retry
                     fallback) renders.

   Already authenticated → straight to the workspace. */
import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";

import { type AuthConfig, fetchAuthConfig, login } from "../auth/bootstrap";
import { hasSession } from "../auth/tokenStorage";
import { createLogger } from "../lib/log";

const log = createLogger("auth");

export default function LoginRoute() {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<AuthConfig["mode"] | null>(null);
  const [failed, setFailed] = useState(false);
  const redirectedRef = useRef(false);

  const authenticated = hasSession();

  // Discover the auth mode (memoized — at most one fetch per app load).
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

  const startLogin = () => {
    log.info("login.start");
    setFailed(false);
    return login().catch((err) => {
      setFailed(true);
      log.error("login.failed", { err: String(err) });
    });
  };

  // workos mode: hand off to WorkOS as soon as the mode resolves. The ref guard
  // keeps the redirect one-shot across React's double-invoked effects.
  useEffect(() => {
    if (authenticated || mode !== "workos" || redirectedRef.current) return;
    redirectedRef.current = true;
    void startLogin();
  }, [authenticated, mode]);

  if (authenticated) return <Navigate to="/" replace />;

  const onDevSignIn = () => {
    setBusy(true);
    void startLogin().finally(() => setBusy(false));
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
      {mode === "dev" ? (
        <button
          disabled={busy}
          onClick={onDevSignIn}
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
          {busy ? "Redirecting…" : "Sign in (dev)"}
        </button>
      ) : mode === "workos" ? (
        failed ? (
          <div style={{ textAlign: "center", font: "16px/1.5 system-ui,sans-serif" }}>
            <p>Couldn’t reach the sign-in service.</p>
            <button
              onClick={() => {
                redirectedRef.current = true;
                void startLogin();
              }}
              style={{
                font: "600 16px/1 system-ui,sans-serif",
                padding: "10px 20px",
                cursor: "pointer",
                border: "3px solid #000",
                borderRadius: 10,
                background: "#ffe14d",
                boxShadow: "4px 4px 0 #000",
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <p style={{ font: "16px/1 system-ui,sans-serif" }}>
            Redirecting to sign-in…
          </p>
        )
      ) : null}
    </div>
  );
}
