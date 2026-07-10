// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  summarizeRowCount,
  type UploadFile,
  useUploadProgress,
} from "./useUploadProgress";

const file = (rows: number | null): UploadFile => ({
  name: "f.csv",
  rows,
  when: "just now",
});

describe("summarizeRowCount", () => {
  it("sums known counts", () => {
    expect(summarizeRowCount([file(3), file(4)])).toBe("7 rows");
  });

  it("reports the count as unavailable when nothing is known", () => {
    expect(summarizeRowCount([file(null)])).toBe("row count unavailable");
  });

  it("marks a partial total with + when some counts are unknown", () => {
    expect(summarizeRowCount([file(10), file(null)])).toBe("10+ rows");
  });

  it("shows 0 rows for an empty file list", () => {
    expect(summarizeRowCount([])).toBe("0 rows");
  });
});

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

  it("reports null rows — not a fabricated or zero count — when the file can't be parsed", async () => {
    const { result, run } = driveUpload(
      new File([""], "empty.csv", { type: "text/csv" }),
    );

    await act(async () => {
      run();
      await vi.runAllTimersAsync();
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].rows).toBeNull();
  });
});
