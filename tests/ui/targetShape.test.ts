import { describe, expect, it } from "vitest";
import type { Note } from "../../src/analysis/types";
import { loadTargets } from "../../src/scoring/score";
import { builtInShape, referenceShape, type ShapeNote } from "../../src/ui/charts/targetShape";

function spacingsMs(shape: ShapeNote[]): number[] {
  return shape.slice(1).map((note, i) => Math.round((note.startS - shape[i].startS) * 1000 * 10) / 10);
}

describe("builtInShape", () => {
  it("draws the hail as 6 notes, 300 ms apart, shrinking from 250 to 125 ms and fading 8 dB", () => {
    const shape = builtInShape(loadTargets("hail"));
    expect(shape).toHaveLength(6);
    expect(shape[0].startS).toBe(0);
    expect(shape[0].durationMs).toBeCloseTo(250);
    expect(shape[5].durationMs).toBeCloseTo(125);
    expect(spacingsMs(shape)).toEqual([300, 300, 300, 300, 300]);
    expect(shape[0].levelDb - shape[5].levelDb).toBeCloseTo(8);
  });

  it("holds the level for the first two notes, then fades evenly", () => {
    const levels = builtInShape(loadTargets("hail")).map((note) => note.levelDb);
    expect(levels[1]).toBeCloseTo(levels[0]);
    const steps = levels.slice(2).map((level, i) => levels[i + 1] - level);
    for (const step of steps) expect(step).toBeCloseTo(2);
  });

  it("shrinks the notes linearly", () => {
    const lengths = builtInShape(loadTargets("hail")).map((note) => note.durationMs);
    expect(lengths.map((ms) => Math.round(ms))).toEqual([250, 225, 200, 175, 150, 125]);
  });

  it("draws the comeback as 7 faster notes from 200 to 100 ms", () => {
    const shape = builtInShape(loadTargets("comeback"));
    expect(shape).toHaveLength(7);
    expect(shape[0].durationMs).toBeCloseTo(200);
    expect(shape[6].durationMs).toBeCloseTo(100);
    expect(spacingsMs(shape)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(shape[0].levelDb - shape[6].levelDb).toBeCloseTo(8);
  });

  it("draws the quack as one 280 ms note", () => {
    expect(builtInShape(loadTargets("quack"))).toEqual([{ startS: 0, durationMs: 280, levelDb: 0 }]);
  });

  it("draws the chuckle as 3 bursts of 4 short notes at the middle burst spacing, 400 ms between bursts", () => {
    const shape = builtInShape(loadTargets("chuckle"));
    expect(shape).toHaveLength(12);
    for (const note of shape) {
      expect(note.durationMs).toBe(60);
      expect(note.levelDb).toBe(0);
    }
    const burst = 132.5;
    expect(spacingsMs(shape)).toEqual([burst, burst, burst, 400, burst, burst, burst, 400, burst, burst, burst]);
  });
});

describe("referenceShape", () => {
  it("keeps each reference note's onset, length and peak level", () => {
    const note = (startS: number, durationMs: number, peakDb: number): Note => ({
      startS,
      endS: startS + durationMs / 1000,
      durationMs,
      peakDb,
      resonanceHz: 1900,
      fundamentalHz: null,
      squeakShare: 0.1,
      flatness: 0.05,
    });
    expect(referenceShape([note(0.5, 200, -12), note(0.8, 150, -18)])).toEqual([
      { startS: 0.5, durationMs: 200, levelDb: -12 },
      { startS: 0.8, durationMs: 150, levelDb: -18 },
    ]);
  });
});
