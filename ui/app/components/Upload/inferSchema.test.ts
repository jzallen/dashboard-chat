import { describe, expect, it } from "vitest";

import { inferSchema } from "./inferSchema";

describe("inferSchema — header detection", () => {
  it("reads the first non-blank line as column names", () => {
    const result = inferSchema("id,name,age\n1,Ada,42");
    expect(result?.cols.map((c) => c.name)).toEqual(["id", "name", "age"]);
  });

  it("names a blank header column_<n> using its 1-based position", () => {
    const result = inferSchema("id,,age\n1,x,42");
    expect(result?.cols.map((c) => c.name)).toEqual(["id", "column_2", "age"]);
  });

  it("counts data rows as non-blank lines minus the header", () => {
    const result = inferSchema("id\n1\n2\n3");
    expect(result?.rows).toBe(3);
  });
});

describe("inferSchema — type detection", () => {
  it("marks a column number when every sampled value parses as a number", () => {
    const result = inferSchema("qty\n1\n2\n3");
    expect(result?.cols[0]).toEqual({ name: "qty", type: "number" });
  });

  it("marks a column text when any sampled value is non-numeric", () => {
    const result = inferSchema("mixed\n1\ntwo\n3");
    expect(result?.cols[0].type).toBe("text");
  });

  it("marks a column text when it has no non-empty sampled values", () => {
    const result = inferSchema("empty\n\n");
    expect(result?.cols[0].type).toBe("text");
  });

  it("samples only the first seven data rows for type detection", () => {
    // Eighth data row is non-numeric but sits outside the sample window,
    // so the column is still inferred as number.
    const rows = ["n", "1", "2", "3", "4", "5", "6", "7", "oops"].join("\n");
    const result = inferSchema(rows);
    expect(result?.cols[0].type).toBe("number");
    expect(result?.rows).toBe(8);
  });
});

describe("inferSchema — quoting", () => {
  it("strips surrounding double quotes from headers", () => {
    const result = inferSchema('"id","name"\n1,Ada');
    expect(result?.cols.map((c) => c.name)).toEqual(["id", "name"]);
  });
});

describe("inferSchema — blank and empty input", () => {
  it("returns null when the text has no non-blank lines", () => {
    expect(inferSchema("")).toBeNull();
    expect(inferSchema("\n  \n\r\n")).toBeNull();
  });

  it("ignores blank lines between rows when counting and sampling", () => {
    const result = inferSchema("id\n1\n\n2\n");
    expect(result?.rows).toBe(2);
  });

  it("tolerates CRLF line endings", () => {
    const result = inferSchema("id,name\r\n1,Ada\r\n");
    expect(result?.cols.map((c) => c.name)).toEqual(["id", "name"]);
    expect(result?.rows).toBe(1);
  });
});
