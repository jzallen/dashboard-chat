import { useState } from "react";

import { post } from "../../../api/client";
import { useAuth } from "../../../auth";

interface CreateOrgResponse {
  org_id: string;
  org_name: string;
  requires_reauth?: boolean;
}

export function CreateOrg() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await post<CreateOrgResponse>("/api/orgs", { name: name.trim() });
      if (result.requires_reauth) {
        await login(result.org_id);
      } else {
        // Dev mode: update stored user with new org_id and reload so AuthProvider picks it up
        const userJson = localStorage.getItem("auth_user");
        if (userJson) {
          const user = JSON.parse(userJson);
          user.org_id = result.org_id;
          localStorage.setItem("auth_user", JSON.stringify(user));
        }
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "320px" }}>
        <h2 style={{ margin: 0 }}>Create Organization</h2>
        <input
          type="text"
          placeholder="Organization name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSubmitting}
          autoFocus
          style={{ padding: "0.5rem", fontSize: "1rem" }}
        />
        {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={isSubmitting || !name.trim()} style={{ padding: "0.5rem", fontSize: "1rem" }}>
          {isSubmitting ? "Creating..." : "Create Organization"}
        </button>
      </form>
    </div>
  );
}
