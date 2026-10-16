import { describe, expect, it } from "vitest";
import { cropLength, mixToMono } from "../../src/ui/decode";

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

  it("mixes only the first samples when given a length", () => {
    const mono = mixToMono([new Float32Array([1, 0, -1, 1]), new Float32Array([0, 0.5, 1, 1])], 2);
    expect(Array.from(mono)).toEqual([0.5, 0.25]);
    expect(mixToMono([new Float32Array([0.5, 0.25])], 10)).toHaveLength(2);
  });
});

describe("cropLength", () => {
  it("keeps audio no longer than the limit whole", () => {
    expect(cropLength(10 * 48_000, 48_000, 15)).toEqual({ length: 480_000, truncated: false });
    expect(cropLength(15 * 48_000, 48_000, 15)).toEqual({ length: 720_000, truncated: false });
  });

  it("keeps only the first seconds of longer audio", () => {
    expect(cropLength(20 * 48_000, 48_000, 15)).toEqual({ length: 720_000, truncated: true });
    expect(cropLength(15 * 44_100 + 1, 44_100, 15)).toEqual({ length: 661_500, truncated: true });
  });

  it("keeps everything when there is no limit", () => {
    expect(cropLength(100 * 48_000, 48_000, Infinity)).toEqual({ length: 4_800_000, truncated: false });
  });
});
