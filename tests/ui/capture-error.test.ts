import { describe, expect, it } from "vitest";
import { describeCaptureError } from "../../src/ui/capture-error";

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("describeCaptureError", () => {
  it("explains a blocked microphone and keeps the original cause", () => {
    const result = describeCaptureError(namedError("NotAllowedError", "Microphone access was denied (Permission dismissed)"));
    expect(result.summary).toMatch(/blocked/i);
    expect(result.detail).toBe("NotAllowedError: Microphone access was denied (Permission dismissed)");
  });

  it("keeps the real cause when the recorder wraps a failure as NotSupportedError", () => {
    const wrapped = namedError(
      "NotSupportedError",
      "The microphone could not be opened: NotReadableError (Could not start audio source)",
    );
    const result = describeCaptureError(wrapped);
    expect(result.summary).toMatch(/can't record audio/i);
    expect(result.detail).toContain("NotReadableError");
    expect(result.detail).toContain("Could not start audio source");
  });

  it("uses a generic summary for other errors and still shows name and message", () => {
    const result = describeCaptureError(new TypeError("Cannot read properties of undefined"));
    expect(result.summary).toMatch(/something went wrong/i);
    expect(result.detail).toBe("TypeError: Cannot read properties of undefined");
  });

  it("shows only the name when the message is empty", () => {
    expect(describeCaptureError(namedError("AbortError", "")).detail).toBe("AbortError");
  });

  it("handles values that are not Error objects", () => {
    expect(describeCaptureError("boom").detail).toBe("boom");
    expect(describeCaptureError(undefined).detail).toBe("Unknown error");
    expect(describeCaptureError({ code: 1 }).detail).toBe("Unknown error");
  });
});
