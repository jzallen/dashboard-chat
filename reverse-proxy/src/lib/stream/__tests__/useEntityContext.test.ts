import { act,renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEntityContext } from "../useEntityContext";

describe("useEntityContext", () => {
  describe("setContext", () => {
    it("sets entityType and entityId together", () => {
      const { result } = renderHook(() => useEntityContext());

      act(() => {
        result.current.setContext("dataset", "ds-1");
      });

      expect(result.current.entityType).toBe("dataset");
      expect(result.current.entityId).toBe("ds-1");
    });

    it("sets view context", () => {
      const { result } = renderHook(() => useEntityContext());

      act(() => {
        result.current.setContext("view", "v-1");
      });

      expect(result.current.entityType).toBe("view");
      expect(result.current.entityId).toBe("v-1");
    });

    it("clears context when type is null", () => {
      const { result } = renderHook(() => useEntityContext());

      act(() => {
        result.current.setContext("dataset", "ds-1");
      });
      expect(result.current.entityType).toBe("dataset");

      act(() => {
        result.current.setContext(null, null);
      });

      expect(result.current.entityType).toBeNull();
      expect(result.current.entityId).toBeNull();
    });
  });
});
