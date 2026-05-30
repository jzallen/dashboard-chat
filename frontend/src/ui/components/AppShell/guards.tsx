// RequireAuth / RequireOrg helpers relocated from frontend/App.tsx per DWD-6.
// These guards wrap the AppShell layout (and /org/create) to preserve the
// pre-MR-0 authentication and organization-membership invariants.
import { Navigate } from "react-router";

import { useAuth } from "../../context/AuthContext";

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export function RequireOrg({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user?.org_id) return <Navigate to="/org/create" replace />;
  return children;
}
