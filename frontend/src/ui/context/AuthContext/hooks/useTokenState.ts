import { useDevTokenState } from "./useDevTokenState";
import { useWorkosTokenState } from "./useWorkosTokenState";

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || "workos";

export const useTokenState = AUTH_MODE === "dev" ? useDevTokenState : useWorkosTokenState;
