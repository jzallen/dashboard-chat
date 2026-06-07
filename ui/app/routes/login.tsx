/* /login — the dev sign-in route. One button kicks off GET /api/auth/login
   (the auth-proxy redirect). Already authenticated → straight to the workspace.
   AUTH_MODE=dev happy path. */
import { useState } from "react";
import { Navigate } from "react-router";

import { login } from "../auth/bootstrap";
import { getToken } from "../auth/tokenStorage";
import { createLogger } from "../lib/log";

const log = createLogger("auth");

export default function LoginRoute() {
  const [busy, setBusy] = useState(false);

  if (getToken()) return <Navigate to="/" replace />;

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
        {busy ? "Redirecting…" : "Sign in (dev)"}
      </button>
    </div>
  );
}
