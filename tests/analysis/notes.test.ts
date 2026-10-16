import { describe, expect, it } from "vitest";
import { findNotes, noiseFloorDb } from "../../src/analysis/notes";

const FLOOR_DB = -60;

/** Builds a level array from [frameCount, levelDb] runs. */
function levels(...runs: Array<[number, number]>): Float32Array {
  const out: number[] = [];
  for (const [count, db] of runs) {
    for (let i = 0; i < count; i++) out.push(db);
  }
  return Float32Array.from(out);
}

const quiet = (count: number): [number, number] => [count, FLOOR_DB];

describe("noiseFloorDb", () => {
  it("takes the 10th percentile with linear interpolation", () => {
    expect(noiseFloorDb(Float32Array.from([0, 10, 20, 30, 40]))).toBeCloseTo(4, 5);
    expect(noiseFloorDb(Float32Array.from([40, 0, 30, 10, 20]))).toBeCloseTo(4, 5);
  });

  it("returns the single value for a one-frame input", () => {
    expect(noiseFloorDb(Float32Array.from([-50]))).toBe(-50);
  });

  it("returns -Infinity for empty input", () => {
    expect(noiseFloorDb(new Float32Array(0))).toBe(-Infinity);
  });

  it("does not reorder the caller's array", () => {
    const input = Float32Array.from([3, 1, 2]);
    noiseFloorDb(input);
    expect(Array.from(input)).toEqual([3, 1, 2]);
  });
});

describe("findNotes", () => {
  it("returns no notes for empty input", () => {
    expect(findNotes(new Float32Array(0), FLOOR_DB)).toEqual([]);
  });

  it("finds one block of loud frames exactly", () => {
    const notes = findNotes(levels(quiet(10), [30, -20], quiet(20)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 10, endFrame: 40 }]);
  });

  it("closes a note that is still loud at the end of the array", () => {
    const notes = findNotes(levels(quiet(10), [30, -20]), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 10, endFrame: 40 }]);
  });

  it("merges blocks separated by a gap shorter than 25 ms", () => {
    // Quiet blocks with a shallow gap: the 2-frame gap is a dip of under 6 dB, so the dip split keeps them joined.
    const notes = findNotes(levels(quiet(10), [20, -46], [2, -53], [20, -46], quiet(10)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 10, endFrame: 52 }]);
  });

  it("re-splits a merged gap that is also a dip of 6 dB or more", () => {
    // Spec order is merge gaps, then dip split, so a deep short gap is merged and then cut again.
    const notes = findNotes(levels(quiet(10), [20, -20], quiet(2), [20, -20], quiet(10)), FLOOR_DB);
    expect(notes).toEqual([
      { startFrame: 10, endFrame: 30 },
      { startFrame: 32, endFrame: 52 },
    ]);
  });

  it("keeps blocks apart when the gap is 25 ms or longer", () => {
    const notes = findNotes(levels(quiet(10), [20, -20], quiet(3), [20, -20], quiet(10)), FLOOR_DB);
    expect(notes).toHaveLength(2);
  });

  it("drops a block shorter than 30 ms", () => {
    expect(findNotes(levels(quiet(10), [2, -20], quiet(10)), FLOOR_DB)).toEqual([]);
  });

  it("keeps a block of exactly 30 ms", () => {
    const notes = findNotes(levels(quiet(10), [3, -20], quiet(10)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 10, endFrame: 13 }]);
  });

  it("uses hysteresis: stays on between the off and on thresholds", () => {
    // On at -48 dB, off at -52 dB. -50 dB frames continue a note but cannot start one.
    expect(findNotes(levels(quiet(5), [20, -50], quiet(5)), FLOOR_DB)).toEqual([]);
    const notes = findNotes(levels(quiet(5), [10, -46], [4, -50], [10, -46], quiet(5)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 5, endFrame: 29 }]);
  });

  it("splits a loud region at a dip of 6 dB or more", () => {
    const notes = findNotes(levels(quiet(10), [15, -20], [5, -30], [15, -20], quiet(10)), FLOOR_DB);
    expect(notes).toHaveLength(2);
    expect(notes[0].startFrame).toBe(10);
    expect(notes[1].endFrame).toBe(45);
    expect(notes[0].endFrame).toBe(notes[1].startFrame);
    expect(notes[0].endFrame).toBeGreaterThan(24);
    expect(notes[0].endFrame).toBeLessThan(30);
  });

  it("does not split at a dip shallower than 6 dB", () => {
    const notes = findNotes(levels(quiet(10), [15, -20], [5, -24], [15, -20], quiet(10)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 10, endFrame: 45 }]);
  });

  it("merges a short quiet echo tail into the previous note", () => {
    const notes = findNotes(levels(quiet(10), [20, -20], quiet(5), [8, -35], quiet(10)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 10, endFrame: 43 }]);
  });

  it("keeps a blip longer than 100 ms as its own note", () => {
    const notes = findNotes(levels(quiet(10), [20, -20], quiet(5), [12, -35], quiet(10)), FLOOR_DB);
    expect(notes).toHaveLength(2);
  });

  it("keeps a blip that is less than 12 dB quieter as its own note", () => {
    const notes = findNotes(levels(quiet(10), [20, -20], quiet(5), [8, -30], quiet(10)), FLOOR_DB);
    expect(notes).toHaveLength(2);
  });

  it("keeps a blip that starts 120 ms or more after the previous note", () => {
    const notes = findNotes(levels(quiet(10), [20, -20], quiet(12), [8, -35], quiet(10)), FLOOR_DB);
    expect(notes).toHaveLength(2);
  });

  it("compares a second tail against the note as already extended by the first", () => {
    const notes = findNotes(
      levels(quiet(10), [20, -20], quiet(6), [5, -35], quiet(6), [5, -35], quiet(10)),
      FLOOR_DB,
    );
    expect(notes).toEqual([{ startFrame: 10, endFrame: 52 }]);
  });

  it("trims frames more than 18 dB below the note's peak from both edges", () => {
    // -45 dB is above the on/off thresholds (so inside the note) but below peak - 18 = -38 dB.
    const notes = findNotes(levels(quiet(10), [5, -45], [20, -20], [5, -45], quiet(10)), FLOOR_DB);
    expect(notes).toEqual([{ startFrame: 15, endFrame: 35 }]);
  });
});
