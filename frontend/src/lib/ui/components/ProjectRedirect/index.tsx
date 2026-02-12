import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listProjects } from "@/api";

export function ProjectRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    listProjects()
      .then((projects) => {
        if (projects.length > 0) {
          navigate(`/projects/${projects[0].id}`, { replace: true });
        } else {
          setEmpty(true);
        }
      })
      .catch(() => setError("Failed to load projects."));
  }, [navigate]);

  if (error) return <div style={{ padding: "2rem" }}>{error}</div>;
  // TODO: replace with a "Create Project" flow so users aren't stuck on an empty state
  if (empty) return <div style={{ padding: "2rem" }}>No projects yet.</div>;
  return null;
}
