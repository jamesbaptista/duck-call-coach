import { describe, expect, it } from "vitest";
import { buildId, DEV_BUILD_ID } from "../../src/build/buildId";

const BUILT_AT = new Date(Date.UTC(2026, 9, 16, 9, 5));

describe("buildId", () => {
  it("is the first 8 characters of the commit GitHub Actions is building", () => {
    expect(buildId("5a11623f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b", BUILT_AT)).toBe("5a11623f");
  });

  it("falls back to the UTC build time when there is no commit", () => {
    expect(buildId(undefined, BUILT_AT)).toBe("20261016-0905");
    expect(buildId("", BUILT_AT)).toBe("20261016-0905");
  });

  it("ignores a commit value that isn't a hex hash", () => {
    expect(buildId('"; alert(1); "', BUILT_AT)).toBe("20261016-0905");
    expect(buildId("main", BUILT_AT)).toBe("20261016-0905");
  });

  it("names the development server's build dev", () => {
    expect(DEV_BUILD_ID).toBe("dev");
  });
});
