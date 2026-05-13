import { useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog } from "@/dataCatalog";

import { getErrorMessage } from "../../../lib/errors";
import { useAuth } from "../../context/AuthContext";
import { RequireAuth } from "../AppShell/guards";
import styles from "./CreateOrg.module.css";

const catalog = createDataCatalog(withAuth(fetch));

interface CreateOrgResponse {
  org_id: string;
  org_name: string;
  requires_reauth?: boolean;
}

/** Form for creating a new organization, with automatic re-authentication on success. */
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
      const result = (await catalog.createOrg(
        name.trim(),
      )) as unknown as CreateOrgResponse;
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
      setError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.container}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h2 className={styles.title}>Create Organization</h2>
        <input
          type="text"
          placeholder="Organization name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSubmitting}
          autoFocus
          className={styles.input}
        />
        {error && <p className={styles.error}>{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting || !name.trim()}
          className={styles.submitButton}
        >
          {isSubmitting ? "Creating..." : "Create Organization"}
        </button>
      </form>
    </div>
  );
}

// DWD-6: preserve App.tsx's `<RequireAuth><CreateOrg /></RequireAuth>` wrap when
// the route resolves directly to this module via frontend/app/routes.ts.
const CreateOrgGuarded = () => (
  <RequireAuth>
    <CreateOrg />
  </RequireAuth>
);

export default CreateOrgGuarded;
