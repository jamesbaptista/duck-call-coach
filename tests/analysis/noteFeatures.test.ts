import { describe, expect, it } from "vitest";
import { flatness, fundamentalHz, liveResonanceHz, resonanceHz, squeakShare } from "../../src/analysis/noteFeatures";
import { frameLevelsDb } from "../../src/analysis/frames";
import { highPass } from "../../src/analysis/filter";
import { findNotes, noiseFloorDb } from "../../src/analysis/notes";
import { ANALYSIS } from "../../src/config/analysis";
import { harmonicNote, sine, whiteNoise } from "../helpers/synth";
import { readWav } from "../helpers/wav";

const SR = 48000;
const QUACK = { f0: 350, formantHz: 2000, seconds: 0.25, sr: SR };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe("note features on synthetic notes", () => {
  const quack = harmonicNote(QUACK);
  const onFormant = harmonicNote({ ...QUACK, f0: 400 });

  it("finds the resonance of a harmonic note whose harmonic sits on the formant", () => {
    expect(Math.abs(resonanceHz(onFormant, SR, 0, onFormant.length) - 2000)).toBeLessThan(60);
  });

  // A smoothed log spectrum of a harmonic note peaks on a harmonic, not between two. With f0 = 350 Hz the
  // 2000 Hz formant falls between the 1750 and 2100 Hz harmonics, and the peak lands on 2100 Hz.
  it("snaps the resonance to the nearest strong harmonic when the formant falls between two", () => {
    expect(Math.abs(resonanceHz(quack, SR, 0, quack.length) - 2100)).toBeLessThan(60);
  });

  it("finds the fundamental of a harmonic note", () => {
    const f0 = fundamentalHz(quack, SR, 0, quack.length);
    expect(f0).not.toBeNull();
    expect(Math.abs((f0 as number) - 350)).toBeLessThan(15);
  });

  it("gives a harmonic note a low squeak share and a pure high sine a high one", () => {
    expect(squeakShare(quack, SR, 0, quack.length)).toBeLessThan(0.5);
    const whistle = sine(4000, 0.25, SR);
    expect(squeakShare(whistle, SR, 0, whistle.length)).toBeGreaterThanOrEqual(0.9);
  });

  it("scores white noise as much flatter than a harmonic note", () => {
    const noise = whiteNoise(0.25, SR, 0.3, 7);
    expect(flatness(noise, SR, 0, noise.length)).toBeGreaterThan(5 * flatness(quack, SR, 0, quack.length));
  });

  it("measures only the requested sample range", () => {
    const high = harmonicNote({ ...QUACK, f0: 400, formantHz: 2800 });
    const both = new Float32Array(onFormant.length + high.length);
    both.set(onFormant, 0);
    both.set(high, onFormant.length);
    expect(Math.abs(resonanceHz(both, SR, 0, onFormant.length) - 2000)).toBeLessThan(60);
    expect(Math.abs(resonanceHz(both, SR, onFormant.length, both.length) - 2800)).toBeLessThan(60);
  });

  it("clamps an out-of-range window into the signal", () => {
    const clamped = resonanceHz(quack, SR, -500, quack.length + 9999);
    expect(clamped).toBe(resonanceHz(quack, SR, 0, quack.length));
  });
});

describe("degenerate ranges", () => {
  const x = harmonicNote(QUACK);

  it.each([
    ["empty", 100, 100],
    ["one sample", 100, 101],
    ["reversed", 200, 100],
    ["fully past the end", x.length + 10, x.length + 500],
  ])("handles a %s range", (_label, s0, s1) => {
    expect(resonanceHz(x, SR, s0, s1)).toBeNaN();
    expect(flatness(x, SR, s0, s1)).toBeNaN();
    expect(fundamentalHz(x, SR, s0, s1)).toBeNull();
    expect(squeakShare(x, SR, s0, s1)).toBe(0);
  });

  it("returns a squeak share of 0 when the range holds no full slice", () => {
    const shortSlice = Math.round(ANALYSIS.squeakSliceS * SR) - 1;
    expect(squeakShare(x, SR, 0, shortSlice)).toBe(0);
  });

  it("returns a squeak share of 0 for silence", () => {
    expect(squeakShare(new Float32Array(SR / 4), SR, 0, SR / 4)).toBe(0);
  });
});

describe("liveResonanceHz", () => {
  const binHz = 23.4375;
  const bins = 1024;

  function spectrumWithBump(centerHz: number, floorDb: number): Float32Array {
    const db = new Float32Array(bins).fill(floorDb);
    for (let i = 0; i < bins; i++) db[i] += 30 * Math.exp(-0.5 * ((i * binHz - centerHz) / 300) ** 2);
    return db;
  }

  it("finds a bump in the resonance band", () => {
    const hz = liveResonanceHz(spectrumWithBump(2000, -70), binHz) as number;
    expect(Math.abs(hz - 2000)).toBeLessThan(60);
  });

  it("ignores a louder bump outside the resonance band", () => {
    const db = spectrumWithBump(2000, -70);
    db[Math.round(300 / binHz)] = -10;
    const hz = liveResonanceHz(db, binHz) as number;
    expect(Math.abs(hz - 2000)).toBeLessThan(60);
  });

  it("returns null when the band is below -90 dB", () => {
    expect(liveResonanceHz(new Float32Array(bins).fill(-100), binHz)).toBeNull();
  });

  it("returns null when the spectrum does not reach the band", () => {
    expect(liveResonanceHz(new Float32Array(10).fill(-20), binHz)).toBeNull();
  });
});

describe("steady_quacks fixture", () => {
  it("has a resonance near 2073 Hz and a fundamental near 355 Hz", () => {
    const { samples, sampleRate } = readWav("tests/fixtures/steady_quacks.wav");
    const x = highPass(samples, sampleRate);
    const levels = frameLevelsDb(x, sampleRate);
    const notes = findNotes(levels, noiseFloorDb(levels));
    const hop = Math.round(ANALYSIS.hopS * sampleRate);
    const frame = Math.round(ANALYSIS.frameS * sampleRate);

    const ranges = notes.map((n): [number, number] => [
      n.startFrame * hop,
      Math.min(x.length, n.endFrame * hop + frame),
    ]);
    const resonances = ranges.map(([s0, s1]) => resonanceHz(x, sampleRate, s0, s1));
    const fundamentals = ranges
      .map(([s0, s1]) => fundamentalHz(x, sampleRate, s0, s1))
      .filter((f): f is number => f !== null);

    expect(notes.length).toBeGreaterThanOrEqual(15);
    expect(Math.abs(median(resonances) - 2073)).toBeLessThan(60);
    expect(fundamentals.length).toBeGreaterThan(0);
    expect(Math.abs(median(fundamentals) - 355)).toBeLessThan(15);
  });
});
