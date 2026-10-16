import { describe, expect, it } from "vitest";
import { averageSpectrum } from "../../src/ui/diagnostics-spectrum";

describe("averageSpectrum", () => {
  it("peaks at the frequency of a sine wave", () => {
    const sampleRate = 48000;
    const pcm = Float32Array.from({ length: sampleRate }, (_, i) =>
      Math.sin((2 * Math.PI * 1500 * i) / sampleRate),
    );
    const { magnitudeDb, binHz } = averageSpectrum(pcm, sampleRate, 6000);
    let peakBin = 0;
    magnitudeDb.forEach((db, bin) => {
      if (db > magnitudeDb[peakBin]) peakBin = bin;
    });
    expect(Math.abs(peakBin * binHz - 1500)).toBeLessThanOrEqual(binHz);
    expect(magnitudeDb.length * binHz).toBeGreaterThanOrEqual(6000);
    expect(magnitudeDb.length * binHz).toBeLessThan(6000 + 2 * binHz);
  });

  it("returns a flat floor for a recording shorter than one frame", () => {
    const { magnitudeDb } = averageSpectrum(new Float32Array(100), 48000, 6000);
    expect(new Set(magnitudeDb).size).toBe(1);
  });
});
