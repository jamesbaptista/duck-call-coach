import { describe, expect, it } from "vitest";
import { ANALYSIS, ANALYZER_VERSION } from "../../src/config/analysis";
import { nextPow2, powerSpectrum } from "../../src/analysis/fft";
import { highPass } from "../../src/analysis/filter";
import { SILENT_FRAME_DB, frameLevelsDb, spanSampleRange } from "../../src/analysis/frames";
import { concat, harmonicNote, silence, sine, whiteNoise } from "../helpers/synth";

const SR = 48000;

function rms(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / (to - from));
}

function db(ratio: number): number {
  return 20 * Math.log10(ratio);
}

function peakBin(spectrum: Float32Array): number {
  let best = 0;
  spectrum.forEach((v, i) => {
    if (v > spectrum[best]) best = i;
  });
  return best;
}

describe("ANALYSIS config", () => {
  it("is frozen and carries the spec section 4 values", () => {
    expect(Object.isFrozen(ANALYSIS)).toBe(true);
    expect(ANALYZER_VERSION).toBe("1.0.0");
    expect(ANALYSIS).toMatchObject({
      highPassHz: 200,
      frameS: 0.04,
      hopS: 0.01,
      floorPercentile: 10,
      onDb: 12,
      offDb: 8,
      mergeGapS: 0.025,
      minNoteS: 0.03,
      dipDb: 6,
      dipLookaheadS: 0.25,
      tailMaxS: 0.1,
      tailGapS: 0.12,
      tailDropDb: 12,
      edgeDb: 18,
      resonanceLoHz: 800,
      resonanceHiHz: 4000,
      resonanceSmoothHz: 150,
      fundBandLoHz: 1000,
      fundBandHiHz: 4000,
      fundLagLoHz: 100,
      fundLagHiHz: 700,
      fundMinStrength: 0.25,
      minNoteFftS: 0.25,
      squeakSliceS: 0.03,
      squeakHopS: 0.015,
      squeakLoHz: 2600,
      squeakHalfWidthHz: 150,
      squeakBandLoHz: 300,
      squeakBandHiHz: 6000,
      squeakSkipBelowDb: 20,
      flatLoHz: 300,
      flatHiHz: 6000,
      sequenceGapS: 0.6,
      burstGapS: 0.25,
      minCallNotes: 3,
      minSlopeNotes: 3,
      longNoteMs: 150,
      minSnrDb: 15,
      clipLevel: 0.99,
      clipFraction: 0.005,
    });
  });
});

describe("nextPow2", () => {
  it("rounds up to a power of two", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(1920)).toBe(2048);
    expect(nextPow2(4096)).toBe(4096);
  });
});

describe("powerSpectrum", () => {
  it("peaks within one bin of a 1 kHz sine at 48 kHz", () => {
    const nfft = 4096;
    const spectrum = powerSpectrum(sine(1000, 0.08, SR), nfft, "hann");
    expect(spectrum.length).toBe(nfft / 2 + 1);
    const binHz = SR / nfft;
    expect(Math.abs(peakBin(spectrum) * binHz - 1000)).toBeLessThanOrEqual(binHz);
  });

  it("zero-pads shorter input and matches Parseval for an unwindowed signal", () => {
    const x = whiteNoise(0.01, SR, 0.3, 7);
    const nfft = 1024;
    const spectrum = powerSpectrum(x, nfft, "none");
    let timeEnergy = 0;
    for (const v of x) timeEnergy += v * v;
    let freqEnergy = spectrum[0] + spectrum[nfft / 2];
    for (let k = 1; k < nfft / 2; k++) freqEnergy += 2 * spectrum[k];
    expect(freqEnergy / nfft).toBeCloseTo(timeEnergy, 3);
  });

  it("returns the DC power of an unwindowed constant", () => {
    const spectrum = powerSpectrum(new Float32Array(8).fill(0.5), 8, "none");
    expect(spectrum[0]).toBeCloseTo(16, 4);
    expect(spectrum[1]).toBeCloseTo(0, 6);
  });

  it("applies a symmetric Hann window of the input length before padding", () => {
    // np.hanning(5) = [0, 0.5, 1, 0.5, 0]; the windowed sum of ones is 2, so DC power is 4.
    const spectrum = powerSpectrum(new Float32Array(5).fill(1), 16, "hann");
    expect(spectrum[0]).toBeCloseTo(4, 5);
  });

  it("defaults to the Hann window", () => {
    const x = sine(1000, 0.02, SR);
    expect(powerSpectrum(x, 2048)).toEqual(powerSpectrum(x, 2048, "hann"));
  });

  it("rejects input longer than nfft and non power-of-two sizes", () => {
    expect(() => powerSpectrum(new Float32Array(100), 64)).toThrow(RangeError);
    expect(() => powerSpectrum(new Float32Array(10), 100)).toThrow(RangeError);
  });
});

describe("highPass", () => {
  const edge = Math.round(0.1 * SR);

  it("attenuates a 50 Hz sine by at least 30 dB", () => {
    const x = sine(50, 1, SR);
    const y = highPass(x, SR);
    expect(db(rms(y, edge, y.length - edge) / rms(x, edge, x.length - edge))).toBeLessThanOrEqual(-30);
  });

  it("leaves a 1 kHz sine within 1 dB", () => {
    const x = sine(1000, 1, SR);
    const y = highPass(x, SR);
    expect(Math.abs(db(rms(y, edge, y.length - edge) / rms(x, edge, x.length - edge)))).toBeLessThan(1);
  });

  it("is about -6 dB at the cutoff (zero-phase doubles the -3 dB point)", () => {
    const x = sine(200, 1, SR);
    const y = highPass(x, SR, 200);
    const gain = db(rms(y, edge, y.length - edge) / rms(x, edge, x.length - edge));
    expect(gain).toBeGreaterThan(-6.5);
    expect(gain).toBeLessThan(-5.5);
  });

  it("returns a new array of the same length without touching the input", () => {
    const x = sine(1000, 0.05, SR);
    const copy = Float32Array.from(x);
    const y = highPass(x, SR);
    expect(y).not.toBe(x);
    expect(y.length).toBe(x.length);
    expect(x).toEqual(copy);
  });

  it("handles empty input", () => {
    expect(highPass(new Float32Array(0), SR).length).toBe(0);
  });
});

describe("frameLevelsDb", () => {
  it("gives -3.01 dB for a full-scale sine", () => {
    const levels = frameLevelsDb(sine(1000, 1, SR), SR);
    for (const level of levels) expect(Math.abs(level - -3.01)).toBeLessThan(0.5);
  });

  it("returns floor((48000 - 1920) / 480) + 1 = 97 frames for 1.0 s at 48 kHz", () => {
    expect(frameLevelsDb(new Float32Array(48000), SR).length).toBe(97);
  });

  it("returns no frames when the signal is shorter than one frame", () => {
    expect(frameLevelsDb(new Float32Array(1919), SR).length).toBe(0);
    expect(frameLevelsDb(new Float32Array(1920), SR).length).toBe(1);
  });

  it("reports silence at the 1e-9 floor (-180 dB)", () => {
    const levels = frameLevelsDb(silence(0.1, SR), SR);
    expect(levels[0]).toBeCloseTo(-180, 4);
    expect(levels[0]).toBeCloseTo(SILENT_FRAME_DB, 4);
  });

  it("tracks level changes: a 20 dB quieter segment reads 20 dB lower", () => {
    const x = concat(sine(1000, 0.2, SR, 0.5), sine(1000, 0.2, SR, 0.05));
    const levels = frameLevelsDb(x, SR);
    expect(levels[0] - levels[levels.length - 1]).toBeCloseTo(20, 0);
  });
});

describe("spanSampleRange", () => {
  it("runs from the first frame's start to one frame past the end frame's start (research script)", () => {
    expect(spanSampleRange({ startFrame: 10, endFrame: 25 }, SR, SR)).toEqual([4800, 25 * 480 + 1920]);
    expect(spanSampleRange({ startFrame: 10, endFrame: 25 }, 44100, 44100)).toEqual([4410, 25 * 441 + 1764]);
  });

  it("clamps the end to the signal", () => {
    expect(spanSampleRange({ startFrame: 0, endFrame: 3 }, SR, 2000)).toEqual([0, 2000]);
  });
});

describe("synth helpers", () => {
  it("whiteNoise is reproducible per seed and differs between seeds", () => {
    expect(whiteNoise(0.01, SR, 0.1, 1)).toEqual(whiteNoise(0.01, SR, 0.1, 1));
    expect(whiteNoise(0.01, SR, 0.1, 1)).not.toEqual(whiteNoise(0.01, SR, 0.1, 2));
  });

  it("whiteNoise has roughly the requested standard deviation", () => {
    expect(rms(whiteNoise(1, SR, 0.1, 3))).toBeCloseTo(0.1, 2);
  });

  it("harmonicNote peaks at amp, fades at the edges, and concentrates energy near the formant", () => {
    const note = harmonicNote({ f0: 400, formantHz: 1600, seconds: 0.2, sr: SR, amp: 0.4 });
    let peak = 0;
    for (const v of note) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.4 + 1e-6);
    expect(peak).toBeGreaterThan(0.39);
    expect(note[0]).toBe(0);
    const spectrum = powerSpectrum(note.subarray(0, 4096), 8192, "hann");
    expect(Math.abs((peakBin(spectrum) * SR) / 8192 - 1600)).toBeLessThanOrEqual(400);
  });

  it("concat and silence build the expected lengths", () => {
    expect(concat(silence(0.5, 1000), sine(10, 0.25, 1000)).length).toBe(750);
  });
});
