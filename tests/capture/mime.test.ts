import { describe, expect, it } from "vitest";
import { pickMimeType } from "../../src/capture/mime";

describe("pickMimeType", () => {
  it("returns the first supported type in preference order", () => {
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/webm")).toBe("audio/webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});
