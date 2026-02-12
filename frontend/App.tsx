import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./src/lib/auth";
import { AppShell } from "./src/lib/ui/components/AppShell";
import { ProjectView } from "./src/lib/ui/components/DatasetView";
import { ProjectRedirect } from "./src/lib/ui/components/ProjectRedirect";
import { SessionList } from "./src/lib/ui/components/SessionViewer/SessionList";
import { SessionViewer } from "./src/lib/ui/components/SessionViewer";
import { LoginPage } from "./src/lib/ui/components/LoginPage";
import { AuthCallback } from "./src/lib/ui/components/AuthCallback";
import { LogoutPage } from "./src/lib/ui/components/LogoutPage";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/projects" element={<RequireAuth><ProjectRedirect /></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/projects/:projectId" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId/sessions" element={<SessionList />} />
        <Route path="/projects/:projectId/datasets/:datasetId/sessions/:sessionId" element={<SessionViewer />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
