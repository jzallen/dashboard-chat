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
      navigate("/login", { replace: true });
      return;
    }
    calledRef.current = true;
    handleCallback(code)
      .then(() => navigate("/projects", { replace: true }))
      .catch(() => navigate("/login", { replace: true }));
  }, [searchParams, handleCallback, navigate]);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <p>Completing login...</p>
    </div>
  );
}
