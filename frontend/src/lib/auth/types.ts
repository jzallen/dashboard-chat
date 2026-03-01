/** The authenticated user's identity, sourced from WorkOS JWT or dev defaults. */
export interface AuthUser {
  id: string;
  email: string;
  org_id: string | null;
  name: string | null;
}

/** Current authentication state held in AuthContext. */
export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
