import { describe, expect, it } from "vitest";
import { decodeBase64, decodedByteLength, encodeBase64 } from "../../src/storage/base64";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("encodeBase64", () => {
  it("matches the standard encoding for every padding case", () => {
    expect(encodeBase64(bytes())).toBe("");
    expect(encodeBase64(bytes(102))).toBe("Zg==");
    expect(encodeBase64(bytes(102, 111))).toBe("Zm8=");
    expect(encodeBase64(bytes(102, 111, 111))).toBe("Zm9v");
    expect(encodeBase64(bytes(251, 255, 254))).toBe("+//+");
  });

  it("handles input far larger than one chunk without overflowing the call stack", () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    for (let i = 0; i < big.length; i += 4099) big[i] = i % 251;
    const decoded = decodeBase64(encodeBase64(big));
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBe(big.length);
    expect(Buffer.from(decoded!).equals(Buffer.from(big))).toBe(true);
  });
});

describe("decodeBase64", () => {
  it("round-trips every byte value at every length mod 3", () => {
    for (const length of [0, 1, 2, 3, 256, 257, 258]) {
      const input = new Uint8Array(length).map((_, i) => i % 256);
      expect([...decodeBase64(encodeBase64(input))!]).toEqual([...input]);
    }
  });

  it.each([
    ["a length that is not a multiple of 4", "Zm9"],
    ["a character outside the alphabet", "Zm9*"],
    ["a space", "Zm9v Zm9v"],
    ["a newline", "Zm9v\nZm9v"],
    ["URL-safe characters", "-_-_"],
    ["padding in the middle", "Zg==Zm9v"],
    ["three padding characters", "Z==="],
    ["padding where data should be", "=Zm9"],
    ["stray bits after the last byte", "Zh=="],
    ["stray bits after the last two bytes", "Zm9="],
  ])("rejects %s", (_name, text) => {
    expect(decodeBase64(text)).toBeNull();
  });
});

describe("decodedByteLength", () => {
  it("gives the decoded size without decoding, or null for a length that cannot be base64", () => {
    expect(decodedByteLength("")).toBe(0);
    expect(decodedByteLength("Zg==")).toBe(1);
    expect(decodedByteLength("Zm8=")).toBe(2);
    expect(decodedByteLength("Zm9v")).toBe(3);
    expect(decodedByteLength("Zm9")).toBeNull();
  });
});
