import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../auth";

export function LogoutPage() {
  const { logout, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      logout();
    }
  }, [isAuthenticated, logout]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return null;
}
