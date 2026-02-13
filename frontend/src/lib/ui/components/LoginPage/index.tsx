import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../auth";

export function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      login();
    }
  }, [isLoading, isAuthenticated, login]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <p>Redirecting to login...</p>
    </div>
  );
}
