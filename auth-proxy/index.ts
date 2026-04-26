import { serve } from "@hono/node-server";

import { app } from "./app.ts";
import { logImageIdentity } from "./version.ts";

logImageIdentity("dashboard-auth-proxy");

const PORT = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.debug(`Auth proxy listening on port ${PORT}`);
});
