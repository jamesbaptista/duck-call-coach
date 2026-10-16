import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/analyze";
import { buildSequences, measureCall, pickScored } from "../../src/analysis/measure";
import { clippedFraction } from "../../src/analysis/quality";
import type { AnalysisResult, CallMeasurements, CallType, Note } from "../../src/analysis/types";
import { ANALYZER_VERSION } from "../../src/config/analysis";
import { concat, harmonicNote, silence, whiteNoise } from "../helpers/synth";
import { readWav } from "../helpers/wav";

const SR = 48000;

interface NoteOptions {
  peakDb?: number;
  resonanceHz?: number;
  squeakShare?: number | null;
  flatness?: number;
}

/** A hand-built note for the measurement unit tests. */
function note(startS: number, durationMs: number, options: NoteOptions = {}): Note {
  return {
    startS,
    endS: startS + durationMs / 1000,
    durationMs,
    peakDb: options.peakDb ?? -20,
    resonanceHz: options.resonanceHz ?? 2000,
    fundamentalHz: null,
    squeakShare: options.squeakShare === undefined ? 0.1 : options.squeakShare,
    flatness: options.flatness ?? 0.1,
  };
}

function analyzeFixture(name: string, callType: CallType): AnalysisResult {
  const { samples, sampleRate } = readWav(`tests/fixtures/${name}.wav`);
  return analyze(samples, sampleRate, callType);
}

/** The measurements of a result that passed the quality gate. */
function measured(result: AnalysisResult): CallMeasurements {
  expect(result.quality).toBeNull();
  expect(result.measurements).not.toBeNull();
  return result.measurements as CallMeasurements;
}

function expectNear(value: number | null, center: number, tolerance: number): void {
  expect(value).not.toBeNull();
  expect(Math.abs((value as number) - center)).toBeLessThanOrEqual(tolerance);
}

function expectBetween(value: number | null, lo: number, hi: number): void {
  expect(value).not.toBeNull();
  expect(value as number).toBeGreaterThanOrEqual(lo);
  expect(value as number).toBeLessThanOrEqual(hi);
}

/** Linear-interpolation resampler (test-only), as a phone at another sample rate would capture the call. */
function resampleLinear(x: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(((x.length - 1) * toRate) / fromRate) + 1);
  for (let i = 0; i < out.length; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(i0 + 1, x.length - 1);
    out[i] = x[i0] + (x[i1] - x[i0]) * (t - i0);
  }
  return out;
}

describe("measureCall", () => {
  const notes = [
    note(0.0, 160, { peakDb: -20, resonanceHz: 2200, squeakShare: 0.3, flatness: 0.1 }),
    note(0.2, 150, { peakDb: -10, resonanceHz: 2100, squeakShare: null, flatness: 0.4 }),
    note(0.4, 100, { peakDb: -15, resonanceHz: 2000, squeakShare: 0.6, flatness: 0.2 }),
    note(0.7, 60, { peakDb: -25, resonanceHz: 1900, squeakShare: null, flatness: 0.3 }),
  ];
  const m = measureCall(notes, -60);

  it("measures spacing, its evenness and the burst spacing from onsets", () => {
    expect(m.noteCount).toBe(4);
    expect(m.spacingMs).toBeCloseTo(233.333, 2);
    expect(m.spacingCv).toBeCloseTo(47.1405 / 233.333, 3);
    expect(m.burstSpacingMs).toBeCloseTo(200, 6);
  });

  it("measures note lengths", () => {
    expect(m.firstNoteMs).toBe(160);
    expect(m.lastNoteMs).toBe(60);
    expect(m.medianNoteMs).toBe(125);
    expect(m.lastFirstRatio).toBeCloseTo(0.375, 6);
    expect(m.longNoteCount).toBe(1);
  });

  it("measures loudness shape and signal-to-noise", () => {
    expect(m.loudestIndex).toBe(1);
    expect(m.fadeDb).toBe(15);
    expect(m.snrDb).toBe(50);
  });

  it("measures resonance, its slope per note, flatness and the largest measured squeak", () => {
    expect(m.resonanceHz).toBe(2050);
    expect(m.resonanceSlopeHzPerNote).toBeCloseTo(-100, 6);
    expect(m.flatness).toBeCloseTo(0.25, 6);
    expect(m.maxSqueakShare).toBe(0.6);
  });

  it("leaves spacing, burst, ratio and slope null for a single note", () => {
    const single = measureCall([note(0.5, 250, { resonanceHz: 1900 })], -60);
    expect(single).toMatchObject({
      noteCount: 1,
      spacingMs: null,
      spacingCv: null,
      burstSpacingMs: null,
      lastFirstRatio: null,
      resonanceSlopeHzPerNote: null,
      firstNoteMs: 250,
      lastNoteMs: 250,
      medianNoteMs: 250,
      resonanceHz: 1900,
      loudestIndex: 0,
      fadeDb: 0,
    });
  });

  it("leaves the resonance slope null under three notes and the burst spacing null without short gaps", () => {
    const two = measureCall([note(0, 100), note(0.4, 100)], -60);
    expect(two.resonanceSlopeHzPerNote).toBeNull();
    expect(two.burstSpacingMs).toBeNull();
    expect(two.spacingCv).toBe(0);
  });

  it("reports a squeak share of 0 when no note was loud enough to measure", () => {
    const quiet = measureCall([note(0, 100, { squeakShare: null }), note(0.3, 100, { squeakShare: null })], -60);
    expect(quiet.maxSqueakShare).toBe(0);
  });

  it("counts a note of exactly longNoteMs as not long", () => {
    expect(measureCall([note(0, 150), note(0.3, 151)], -60).longNoteCount).toBe(1);
  });

  it("rejects an empty note list", () => {
    expect(() => measureCall([], -60)).toThrow(RangeError);
  });
});

describe("buildSequences and pickScored", () => {
  it("keeps notes together across exactly sequenceGapS of silence and splits beyond it", () => {
    const a = note(0, 100);
    const b = note(0.7, 100); // 0.6 s after a ends
    const c = note(1.41, 100); // 0.61 s after b ends
    expect(buildSequences([a, b, c])).toEqual([[a, b], [c]]);
    expect(buildSequences([])).toEqual([]);
  });

  it("scores the loudest note overall for a quack", () => {
    const loud = note(2, 200, { peakDb: -5 });
    const seqs = [[note(0, 100), note(0.3, 100)], [loud]];
    expect(pickScored(seqs, "quack")).toEqual([loud]);
  });

  it("scores the sequence with the most notes, ties going to the loudest", () => {
    const quietPair = [note(0, 100, { peakDb: -30 }), note(0.3, 100, { peakDb: -30 })];
    const loudPair = [note(2, 100, { peakDb: -10 }), note(2.3, 100, { peakDb: -30 })];
    const triple = [note(4, 100, { peakDb: -40 }), note(4.3, 100), note(4.6, 100)];
    expect(pickScored([quietPair, loudPair], "hail")).toBe(loudPair);
    expect(pickScored([quietPair, triple, loudPair], "chuckle")).toBe(triple);
  });

  it("scores nothing when there are no notes", () => {
    expect(pickScored([], "hail")).toEqual([]);
    expect(pickScored([], "quack")).toEqual([]);
  });
});

describe("clippedFraction", () => {
  it("counts samples at or beyond clipLevel in either direction", () => {
    expect(clippedFraction(Float32Array.from([0.99, -1, 0.5, 0, -0.98, 0.2, 0, 1]))).toBe(3 / 8);
  });

  it("is 0 for empty input", () => {
    expect(clippedFraction(new Float32Array(0))).toBe(0);
  });
});

describe("analyze golden fixtures", () => {
  it("measures hail_a as a hail", () => {
    const result = analyzeFixture("hail_a", "hail");
    const m = measured(result);
    expectBetween(m.noteCount, 9, 10);
    expectNear(m.spacingMs, 235, 10);
    expect(m.spacingCv as number).toBeLessThanOrEqual(0.08);
    expectNear(m.resonanceHz, 1945, 60);
    expect(result.notes[0].resonanceHz - result.notes[result.notes.length - 1].resonanceHz).toBeGreaterThan(0);
    expect(m.fadeDb).toBeGreaterThanOrEqual(4);
    expect(m.maxSqueakShare).toBeLessThan(0.8);
  });

  // The brief's quack golden used quacks_4 (noteCount 1, firstNoteMs 180-300, resonanceHz 1650-2100). That
  // 1.6 s clip is so call-dense that its own 10th-percentile floor (-20 dB) sits far above the research
  // floor (-25.7 dB, Ruling R14), so analyze() cannot reproduce the research notes on it. Per the
  // controller's instruction the quack-mode golden uses steady_quacks instead.
  it("measures steady_quacks as a quack", () => {
    const m = measured(analyzeFixture("steady_quacks", "quack"));
    expect(m.noteCount).toBe(1);
    expectBetween(m.firstNoteMs, 170, 340);
    expectBetween(m.resonanceHz, 1800, 2150);
  });

  it("documents that quacks_4 alone reads as too quiet over its own call-dense floor", () => {
    const result = analyzeFixture("quacks_4", "quack");
    expect(result.noiseFloorDb).toBeGreaterThan(-24);
    expect(result.quality).toBe("too_quiet");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].startS).toBeCloseTo(0.22, 6);
    expect(result.notes[0].durationMs).toBe(140);
  });

  it("measures steady_quacks as a hail", () => {
    const m = measured(analyzeFixture("steady_quacks", "hail"));
    expectBetween(m.noteCount, 18, 20);
    expectNear(m.spacingMs, 508, 15);
  });

  it("measures chuckle_a as a chuckle", () => {
    const m = measured(analyzeFixture("chuckle_a", "chuckle"));
    expectBetween(m.noteCount, 15, 25);
    expectBetween(m.medianNoteMs, 40, 110);
    expectBetween(m.burstSpacingMs, 90, 140);
  });

  it("measures hail_b as a hail", () => {
    const m = measured(analyzeFixture("hail_b", "hail"));
    expect(m.noteCount).toBe(4);
    expectNear(m.spacingMs, 350, 15);
  });

  it("labels the result with its call type and analyzer version", () => {
    const result = analyzeFixture("hail_b", "comeback");
    expect(result.callType).toBe("comeback");
    expect(result.analyzerVersion).toBe(ANALYZER_VERSION);
  });
});

describe("analyze review focus", () => {
  it("never scores silence", () => {
    const result = analyze(silence(3, SR), SR, "hail");
    expect(result.quality).toBe("no_notes");
    expect(result.measurements).toBeNull();
    expect(result.notes).toEqual([]);
    expect(Number.isFinite(result.noiseFloorDb)).toBe(true);
  });

  it("never scores white noise", () => {
    const result = analyze(whiteNoise(3, SR, 0.05, 11), SR, "hail");
    expect(["no_notes", "too_quiet"]).toContain(result.quality);
    expect(result.measurements).toBeNull();
  });

  it("flags a hard-clipped hail as clipped", () => {
    const { samples, sampleRate } = readWav("tests/fixtures/hail_a.wav");
    const clipped = samples.map((value) => Math.max(-1, Math.min(1, value * 20)));
    const result = analyze(clipped, sampleRate, "hail");
    expect(result.quality).toBe("clipped");
    expect(result.measurements).toBeNull();
  });

  it("measures hail_a the same at 44.1 kHz as at 48 kHz", () => {
    const { samples, sampleRate } = readWav("tests/fixtures/hail_a.wav");
    const native = measured(analyze(samples, sampleRate, "hail"));
    const resampled = measured(analyze(resampleLinear(samples, sampleRate, 44100), 44100, "hail"));
    expect(resampled.noteCount).toBe(native.noteCount);
    expectNear(resampled.spacingMs, native.spacingMs as number, 10);
    expectNear(resampled.resonanceHz, native.resonanceHz, 60);
    expectNear(resampled.fadeDb, native.fadeDb, 2);
  });

  it("rejects a single note as too few for a hail but scores it as a quack", () => {
    const lone = concat(silence(0.5, SR), harmonicNote({ f0: 350, formantHz: 2000, seconds: 0.25, sr: SR }), silence(0.5, SR));
    const hail = analyze(lone, SR, "hail");
    expect(hail.quality).toBe("too_few_notes");
    expect(hail.measurements).toBeNull();
    expect(hail.notes).toHaveLength(1);
    const quack = analyze(lone, SR, "quack");
    expect(measured(quack).noteCount).toBe(1);
  });

  it.each([
    ["empty input", new Float32Array(0)],
    ["a single sample", Float32Array.from([0.5])],
    ["less than one frame", whiteNoise(0.02, SR, 0.1, 3)],
  ])("does not throw on %s", (_label, input) => {
    const result = analyze(input, SR, "hail");
    expect(result.quality).toBe("no_notes");
    expect(result.notes).toEqual([]);
    expect(result.measurements).toBeNull();
    expect(Number.isFinite(result.noiseFloorDb)).toBe(true);
  });
});
