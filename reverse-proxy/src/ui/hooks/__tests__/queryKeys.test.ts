import { describe, expect, it } from "vitest";

import {
  datasetKeys,
  orgKeys,
  projectKeys,
  sqlAccessKeys,
} from "../queryKeys";

describe("projectKeys", () => {
  it("all returns base key", () => {
    expect(projectKeys.all).toEqual(["projects"]);
  });

  it("detail includes project id", () => {
    expect(projectKeys.detail("p-1")).toEqual(["projects", "p-1"]);
  });

  it("detail keys differ by id", () => {
    expect(projectKeys.detail("a")).not.toEqual(projectKeys.detail("b"));
  });
});

describe("datasetKeys", () => {
  it("all returns base key", () => {
    expect(datasetKeys.all).toEqual(["datasets"]);
  });

  it("lists extends all", () => {
    expect(datasetKeys.lists()).toEqual(["datasets", "list"]);
  });

  it("list includes project id", () => {
    expect(datasetKeys.list("p-1")).toEqual(["datasets", "list", "p-1"]);
  });

  it("detail includes dataset id", () => {
    expect(datasetKeys.detail("d-1")).toEqual(["datasets", "d-1"]);
  });

  it("list and detail keys do not collide", () => {
    expect(datasetKeys.list("x")).not.toEqual(datasetKeys.detail("x"));
  });
});

describe("orgKeys", () => {
  it("me returns org me key", () => {
    expect(orgKeys.me).toEqual(["org", "me"]);
  });

  it("projects returns org projects key", () => {
    expect(orgKeys.projects).toEqual(["org", "projects"]);
  });
});

describe("sqlAccessKeys", () => {
  it("all returns base key", () => {
    expect(sqlAccessKeys.all).toEqual(["sql-access"]);
  });

  it("detail includes project id", () => {
    expect(sqlAccessKeys.detail("p-1")).toEqual(["sql-access", "p-1"]);
  });

  it("status includes project id", () => {
    expect(sqlAccessKeys.status("p-1")).toEqual(["sql-access", "p-1", "status"]);
  });
});
