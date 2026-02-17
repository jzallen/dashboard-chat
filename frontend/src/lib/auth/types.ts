export interface AuthUser {
  id: string;
  email: string;
  org_id: string | null;
  name: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
