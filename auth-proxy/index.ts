import { serve } from "@hono/node-server";

import { app } from "./app.ts";

const PORT = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.debug(`Auth proxy listening on port ${PORT}`);
});
