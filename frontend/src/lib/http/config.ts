export const DATA_CATALOG_BASE_URL = import.meta.env.VITE_API_URL || "";
// Same-origin via the frontend's nginx /worker/ proxy (frontend/nginx.conf:35).
// nginx strips the /worker/ prefix and forwards to the agent container.
export const CHAT_BASE_URL = import.meta.env.VITE_CHAT_URL || "/worker";
