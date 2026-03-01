import { useEffect } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../../../auth";
import styles from "./LoginPage.module.css";

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
    <div className={styles.container}>
      <p>Redirecting to login...</p>
    </div>
  );
}
