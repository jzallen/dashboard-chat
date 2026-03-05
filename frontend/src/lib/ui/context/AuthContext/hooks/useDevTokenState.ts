import { useEffect, useState } from "react";

import {
  setRefreshToken,
  setToken,
  setTokenExpiry,
  setUser,
} from "../../../../auth/tokenStorage";
import type { AuthState, AuthUser, TokenStateResult } from "../../../../auth/types";

const DEV_USER: AuthUser = { id: "dev-user-001", email: "dev@localhost", org_id: "dev-org-001", name: "Dev User" };
const DEV_TOKEN = "dev-token-static";

export function useDevTokenState(): TokenStateResult {
  const [state, setState] = useState<AuthState>({
    user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: true,
  });

  useEffect(() => {
    setToken(DEV_TOKEN);
    setUser(DEV_USER);
    setRefreshToken("dev-refresh-token-001");
    const devExpiresAt = Date.now() + 300000;
    setTokenExpiry(devExpiresAt);
    setState({
      user: DEV_USER, token: DEV_TOKEN, refreshToken: "dev-refresh-token-001",
      tokenExpiresAt: devExpiresAt, isAuthenticated: true, isLoading: false,
    });
  }, []);

  return { state, setState };
}
