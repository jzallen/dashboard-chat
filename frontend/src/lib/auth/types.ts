export interface AuthUser {
  id: string;
  email: string;
  org_id: string;
  name: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
