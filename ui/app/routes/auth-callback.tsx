/* /auth/callback — exchange the dev auth code for a token, then land on the
   workspace. Replaces the main.js callback branch; keeps the URL-scrub behavior
   (navigate("/",{replace:true}) drops ?code= from history). Mirrors
   frontend/app/routes/auth-callback.tsx (AUTH_MODE=dev: no WorkOS state CSRF). */
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { handleCallback } from "../../src/auth/bootstrap";

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
