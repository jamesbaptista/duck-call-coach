import { describe, expect, it } from "vitest";
import { isStorageNearlyFull, STORAGE_WARNING_TEXT, storageUseText } from "../../src/ui/storageUse";

const MB = 1024 * 1024;

describe("isStorageNearlyFull", () => {
  it("is false when the browser can't say", () => {
    expect(isStorageNearlyFull(null)).toBe(false);
  });

  it("is false with no quota to compare against", () => {
    expect(isStorageNearlyFull({ usage: 10 * MB, quota: 0 })).toBe(false);
  });

  it("is false at exactly 90% and true just above it", () => {
    expect(isStorageNearlyFull({ usage: 90, quota: 100 })).toBe(false);
    expect(isStorageNearlyFull({ usage: 90.1, quota: 100 })).toBe(true);
  });

  it("is true when usage is over the quota", () => {
    expect(isStorageNearlyFull({ usage: 120, quota: 100 })).toBe(true);
  });

  it("is false when nearly empty", () => {
    expect(isStorageNearlyFull({ usage: 0, quota: 100 })).toBe(false);
  });
});

describe("storageUseText", () => {
  it("says how much is used, in MB with one decimal", () => {
    expect(storageUseText({ usage: 1.5 * MB, quota: 1024 * MB }, "en-US")).toBe("Using 1.5 MB of 1,024.0 MB");
  });

  it("rounds to one decimal", () => {
    expect(storageUseText({ usage: 0.04 * MB, quota: 2.26 * MB }, "en-US")).toBe("Using 0.0 MB of 2.3 MB");
  });

  it("is null when the browser can't say, or gives no quota", () => {
    expect(storageUseText(null, "en-US")).toBeNull();
    expect(storageUseText({ usage: MB, quota: 0 }, "en-US")).toBeNull();
  });
});

describe("STORAGE_WARNING_TEXT", () => {
  it("points to Back up", () => {
    expect(STORAGE_WARNING_TEXT).toBe(
      "Your phone is almost out of space for this app. Back up, then delete old attempts.",
    );
  });
});
