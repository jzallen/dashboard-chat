/* /auth/callback — exchange the dev auth code for a token, then land on the
   workspace. The replace navigation scrubs ?code= from history.
   AUTH_MODE=dev path: no WorkOS state CSRF round-trip. */
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { handleCallback } from "../auth/bootstrap";

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
    calledRef.current = true;
    handleCallback(code)
      .then(() => navigate("/", { replace: true }))
      .catch((err) => {
        console.error("auth callback failed", err);
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
