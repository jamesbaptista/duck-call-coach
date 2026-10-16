import { describe, expect, it } from "vitest";
import { mixToMono } from "../../src/ui/screens/practice/decode";

describe("mixToMono", () => {
  it("returns a copy of a single channel", () => {
    const channel = new Float32Array([0.1, -0.2, 0.3]);
    const mono = mixToMono([channel]);
    expect(Array.from(mono)).toEqual(Array.from(channel));
    expect(mono).not.toBe(channel);
  });

  it("averages several channels sample by sample", () => {
    const mono = mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0.5, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.25, 0]);
  });

  it("returns no samples for no channels", () => {
    expect(mixToMono([])).toHaveLength(0);
  });
});
