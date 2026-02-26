import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth";

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleCallback } = useAuth();
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;

    const code = searchParams.get("code");
    if (!code) {
      sessionStorage.removeItem("oauth_state");
      navigate("/login", { replace: true });
      return;
    }

    // OAuth state CSRF verification (D12):
    // Compare the state query param from the callback URL against the value
    // stored in sessionStorage during login(). Reject on mismatch or absence.
    const urlState = searchParams.get("state");
    const storedState = sessionStorage.getItem("oauth_state");
    sessionStorage.removeItem("oauth_state");

    if (!urlState || !storedState || urlState !== storedState) {
      navigate("/login", { replace: true });
      return;
    }

    calledRef.current = true;
    handleCallback(code)
      .then((result) => {
        if (result.org_id) {
          navigate("/", { replace: true });
        } else {
          navigate("/org/create", { replace: true });
        }
      })
      .catch(() => navigate("/login", { replace: true }));
  }, [searchParams, handleCallback, navigate]);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <p>Completing login...</p>
    </div>
  );
}
