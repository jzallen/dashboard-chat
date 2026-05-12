import { mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config";

export default mergeConfig(baseConfig, {
  test: {
    include: ["src/core/dataCatalog/**/*.test.{ts,tsx}"],
  },
});
