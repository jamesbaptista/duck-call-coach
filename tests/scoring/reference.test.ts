import { describe, expect, it } from "vitest";
import type { CallMeasurements, Note } from "../../src/analysis/types";
import { pairNotes, targetsFromReference, withFlatnessBaseline } from "../../src/scoring/reference";
import { loadTargets } from "../../src/scoring/score";
import { NO_UPPER_LIMIT } from "../../src/scoring/types";
import type { CallTargets, MeasureKey, MeasureTarget } from "../../src/scoring/types";

function referenceMeasurements(overrides: Partial<CallMeasurements> = {}): CallMeasurements {
  return {
    noteCount: 5,
    spacingMs: 300,
    spacingCv: 0.05,
    burstSpacingMs: null,
    firstNoteMs: 200,
    lastNoteMs: 100,
    medianNoteMs: 150,
    lastFirstRatio: 0.5,
    loudestIndex: 0,
    fadeDb: 8,
    resonanceHz: 2000,
    resonanceSlopeHzPerNote: -20,
    flatness: 0.1,
    maxSqueakShare: 0.1,
    longNoteCount: 0,
    snrDb: 30,
    ...overrides,
  };
}

function measure(targets: CallTargets, key: MeasureKey): MeasureTarget {
  const found = targets.measures.find((m) => m.key === key);
  if (found === undefined) throw new Error(`no ${key} measure`);
  return found;
}

describe("targetsFromReference", () => {
  it("builds the hail spacing range as the reference spacing plus or minus 15%", () => {
    const result = targetsFromReference(loadTargets("hail"), referenceMeasurements({ spacingMs: 300 }));
    const spacing = measure(result, "spacingMs");
    expect(spacing.lo).toBeCloseTo(255, 9);
    expect(spacing.hi).toBeCloseTo(345, 9);
  });

  it("uses the documented band for each replaced key", () => {
    const result = targetsFromReference(loadTargets("hail"), referenceMeasurements());
    expect(measure(result, "noteCount")).toMatchObject({ lo: 4, hi: 6 });
    expect(measure(result, "resonanceHz")).toMatchObject({ lo: 1850, hi: 2150 });
    expect(measure(result, "fadeDb")).toMatchObject({ lo: 4, hi: 12 });
  });

  it("applies the percent band to the first-note and median-note durations", () => {
    const first = measure(targetsFromReference(loadTargets("quack"), referenceMeasurements({ firstNoteMs: 100 })), "firstNoteMs");
    expect(first.lo).toBeCloseTo(80, 9);
    expect(first.hi).toBeCloseTo(120, 9);
    const median = measure(targetsFromReference(loadTargets("chuckle"), referenceMeasurements({ medianNoteMs: 50 })), "medianNoteMs");
    expect(median.lo).toBeCloseTo(40, 9);
    expect(median.hi).toBeCloseTo(60, 9);
  });

  it("floors the note count lower bound at 1 and the fade lower bound at 0", () => {
    const result = targetsFromReference(loadTargets("hail"), referenceMeasurements({ noteCount: 1, fadeDb: 2 }));
    expect(measure(result, "noteCount")).toMatchObject({ lo: 1, hi: 2 });
    expect(measure(result, "fadeDb")).toMatchObject({ lo: 0, hi: 6 });
  });

  it("replaces a built-in fade upper limit of none with the reference band", () => {
    const hail = loadTargets("hail");
    expect(measure(hail, "fadeDb").hi).toBe(NO_UPPER_LIMIT);
    const result = targetsFromReference(hail, referenceMeasurements({ fadeDb: 10 }));
    expect(measure(result, "fadeDb").hi).toBe(14);
  });

  it("keeps tolerance, weight, sub and the other measures unchanged", () => {
    const hail = loadTargets("hail");
    const result = targetsFromReference(hail, referenceMeasurements());
    expect(result.measures.map((m) => m.key)).toEqual(hail.measures.map((m) => m.key));
    for (const [index, original] of hail.measures.entries()) {
      expect(result.measures[index]).toMatchObject({
        key: original.key,
        tolerance: original.tolerance,
        weight: original.weight,
        sub: original.sub,
      });
    }
    expect(measure(result, "spacingCv")).toEqual(measure(hail, "spacingCv"));
    expect(result.subWeights).toEqual(hail.subWeights);
    expect(result.callType).toBe("hail");
  });

  it("does not add measures that the built-in targets lack", () => {
    const hail = loadTargets("hail");
    expect(hail.measures.some((m) => m.key === "firstNoteMs")).toBe(false);
    const result = targetsFromReference(hail, referenceMeasurements());
    expect(result.measures).toHaveLength(hail.measures.length);
  });

  it("sets confidence to high", () => {
    const low: CallTargets = { ...loadTargets("hail"), confidence: "low" };
    expect(targetsFromReference(low, referenceMeasurements()).confidence).toBe("high");
  });

  it("keeps the built-in range when the reference value is null or not finite", () => {
    const hail = loadTargets("hail");
    const nullSpacing = targetsFromReference(hail, referenceMeasurements({ spacingMs: null }));
    expect(measure(nullSpacing, "spacingMs")).toEqual(measure(hail, "spacingMs"));
    const nanResonance = targetsFromReference(hail, referenceMeasurements({ resonanceHz: Number.NaN }));
    expect(measure(nanResonance, "resonanceHz")).toEqual(measure(hail, "resonanceHz"));
  });

  it("does not mutate its input", () => {
    const hail = loadTargets("hail");
    const before = structuredClone(hail);
    const result = targetsFromReference(hail, referenceMeasurements());
    expect(hail).toEqual(before);
    expect(result).not.toBe(hail);
    expect(result.measures).not.toBe(hail.measures);
  });
});

describe("withFlatnessBaseline", () => {
  it("appends a flatness target of 0.6 to 1.4 times the baseline", () => {
    const result = withFlatnessBaseline(loadTargets("hail"), 0.1);
    const flatness = measure(result, "flatness");
    expect(flatness.lo).toBeCloseTo(0.06, 9);
    expect(flatness.hi).toBeCloseTo(0.14, 9);
    expect(flatness.tolerance).toBeCloseTo(0.06, 9);
    expect(flatness.weight).toBe(1);
    expect(flatness.sub).toBe("tone");
  });

  it("returns targets equal to the input for a null baseline", () => {
    const hail = loadTargets("hail");
    expect(withFlatnessBaseline(hail, null)).toEqual(hail);
  });

  it.each([0, -0.1, Number.NaN, Number.POSITIVE_INFINITY])("returns the input unchanged for baseline %s", (baseline) => {
    const hail = loadTargets("hail");
    expect(withFlatnessBaseline(hail, baseline)).toEqual(hail);
  });

  it("replaces an existing flatness measure instead of duplicating it", () => {
    const once = withFlatnessBaseline(loadTargets("hail"), 0.1);
    const twice = withFlatnessBaseline(once, 0.2);
    expect(twice.measures.filter((m) => m.key === "flatness")).toHaveLength(1);
    expect(measure(twice, "flatness").hi).toBeCloseTo(0.28, 9);
    expect(twice.measures).toHaveLength(once.measures.length);
  });

  it("does not mutate its input", () => {
    const hail = loadTargets("hail");
    const before = structuredClone(hail);
    const result = withFlatnessBaseline(hail, 0.1);
    expect(hail).toEqual(before);
    expect(result.measures).not.toBe(hail.measures);
  });
});

function note(startS: number, durationMs: number, peakDb: number, resonanceHz: number): Note {
  return {
    startS,
    endS: startS + durationMs / 1000,
    durationMs,
    peakDb,
    resonanceHz,
    fundamentalHz: null,
    squeakShare: null,
    flatness: 0.1,
  };
}

function fiveNotes(): Note[] {
  return [
    note(0.0, 200, -10, 2300),
    note(0.4, 160, -14, 1900),
    note(0.8, 120, -20, 1500),
    note(1.2, 100, -27, 2100),
    note(1.6, 80, -35, 1700),
  ];
}

describe("pairNotes", () => {
  it("pairs identical lists note for note", () => {
    expect(pairNotes(fiveNotes(), fiveNotes())).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("leaves the reference note unmatched when the attempt skipped it", () => {
    const attempt = fiveNotes().filter((_, index) => index !== 2);
    expect(pairNotes(attempt, fiveNotes())).toEqual([
      [0, 0],
      [1, 1],
      [null, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it("leaves the attempt note unmatched when the attempt has an extra note", () => {
    const reference = fiveNotes().filter((_, index) => index !== 2);
    expect(pairNotes(fiveNotes(), reference)).toEqual([
      [0, 0],
      [1, 1],
      [2, null],
      [3, 2],
      [4, 3],
    ]);
  });

  it("handles empty lists", () => {
    expect(pairNotes([], fiveNotes())).toEqual([
      [null, 0],
      [null, 1],
      [null, 2],
      [null, 3],
      [null, 4],
    ]);
    expect(pairNotes(fiveNotes(), [])).toEqual([
      [0, null],
      [1, null],
      [2, null],
      [3, null],
      [4, null],
    ]);
    expect(pairNotes([], [])).toEqual([]);
  });

  it("pairs two single-note lists without dividing by zero", () => {
    const only = [note(0.5, 150, -12, 2000)];
    expect(pairNotes(only, only)).toEqual([[0, 0]]);
  });

  it("treats a non-finite resonance as 2000 Hz instead of failing", () => {
    const broken = fiveNotes().map((n) => ({ ...n, resonanceHz: Number.NaN }));
    const pairs = pairNotes(broken, broken);
    expect(pairs).toHaveLength(5);
    expect(pairs.every(([i, j]) => i !== null && i === j)).toBe(true);
  });

  it("compares notes by position within each list, not by absolute time", () => {
    const delayed = fiveNotes().map((n) => ({ ...n, startS: n.startS + 3, endS: n.endS + 3 }));
    expect(pairNotes(delayed, fiveNotes()).every(([i, j]) => i !== null && i === j)).toBe(true);
  });

  it("does not mutate its inputs", () => {
    const attempt = fiveNotes();
    const reference = fiveNotes();
    pairNotes(attempt, reference);
    expect(attempt).toEqual(fiveNotes());
    expect(reference).toEqual(fiveNotes());
  });
});
