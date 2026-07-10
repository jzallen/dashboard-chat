// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUploadProgress } from "./useUploadProgress";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function driveUpload(file: File) {
  const setName = vi.fn();
  const { result } = renderHook(() =>
    useUploadProgress({ source: null, existing: false, name: "", setName }),
  );
  return { result, run: () => result.current.runUpload(file) };
}

describe("useUploadProgress.runUpload — row count", () => {
  it("reports the parsed row count for a readable CSV", async () => {
    const { result, run } = driveUpload(
      new File(["id,name\n1,Ada\n2,Bo\n3,Cy"], "people.csv", {
        type: "text/csv",
      }),
    );

    await act(async () => {
      run();
      await vi.runAllTimersAsync();
    });

    expect(result.current.view).toBe("schema");
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].rows).toBe(3);
  });

  it("reports 0 rows — not a fabricated number — when the file can't be parsed", async () => {
    const { result, run } = driveUpload(
      new File([""], "empty.csv", { type: "text/csv" }),
    );

    await act(async () => {
      run();
      await vi.runAllTimersAsync();
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].rows).toBe(0);
  });
});
