import { mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config";

export default mergeConfig(baseConfig, {
  test: {
    include: ["src/ui/hooks/**/*.test.{ts,tsx}"],
  },
});
