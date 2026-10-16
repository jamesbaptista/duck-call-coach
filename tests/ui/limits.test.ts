import { describe, expect, it } from "vitest";
import { MAX_IMPORT_S, MAX_RECORDING_S, pastPlaybackLimit } from "../../src/ui/limits";

describe("limits", () => {
  it("records for at most 15 s and imports files of at most 10 minutes", () => {
    expect(MAX_RECORDING_S).toBe(15);
    expect(MAX_IMPORT_S).toBe(600);
  });
});

describe("pastPlaybackLimit", () => {
  it("lets a reference play up to the 15 s that are scored", () => {
    expect(pastPlaybackLimit(0)).toBe(false);
    expect(pastPlaybackLimit(14.99)).toBe(false);
  });

  it("stops it at 15 s and beyond", () => {
    expect(pastPlaybackLimit(15)).toBe(true);
    expect(pastPlaybackLimit(42)).toBe(true);
  });

  it("ignores an unknown position", () => {
    expect(pastPlaybackLimit(Number.NaN)).toBe(false);
  });
});
