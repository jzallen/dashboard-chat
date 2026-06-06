/* /login — the dev sign-in route. Replaces renderSignIn() in main.js: one
   button that kicks off GET /api/auth/login (the auth-proxy redirect). Already
   authenticated → straight to the workspace. Mirrors frontend/app/routes/login.tsx
   (a route module that re-exports a LoginPage), AUTH_MODE=dev happy path. */
import { useState } from "react";
import { Navigate } from "react-router";

import { login } from "../../src/auth/bootstrap";
import { getToken } from "../../src/auth/tokenStorage";

export default function LoginRoute() {
  const [busy, setBusy] = useState(false);

  if (getToken()) return <Navigate to="/" replace />;

  const onSignIn = () => {
    setBusy(true);
    login().catch((err) => {
      setBusy(false);
      console.error("login failed", err);
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
