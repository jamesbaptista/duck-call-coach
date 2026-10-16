import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/analyze";
import { measureCall } from "../../src/analysis/measure";
import type { CallMeasurements, CallType } from "../../src/analysis/types";
import { loadTargets, scoreAttempt, scoreMeasure } from "../../src/scoring/score";
import targetsJson from "../../src/scoring/targets.json";
import { parseTargets } from "../../src/scoring/targetsSchema";
import { loadTips, selectTips } from "../../src/scoring/tips";
import { CALL_TYPES, SUB_SCORES } from "../../src/scoring/types";
import type { MeasureTarget } from "../../src/scoring/types";
import { readWav } from "../helpers/wav";

const SPACING_RANGE = { lo: 230, hi: 370, tolerance: 120 } as MeasureTarget;
const FAST_SPACING_SCORE = 100 * (1 - 89 / 120); // 141 ms is 89 ms below the 230 ms edge

function hailAMeasurements(): CallMeasurements {
  const { samples, sampleRate } = readWav("tests/fixtures/hail_a.wav");
  const { measurements } = analyze(samples, sampleRate, "hail");
  if (measurements === null) throw new Error("hail_a produced no measurements");
  return measurements;
}

function chuckleMeasurements(): CallMeasurements {
  return {
    noteCount: 6,
    spacingMs: null,
    spacingCv: null,
    burstSpacingMs: 130,
    firstNoteMs: 60,
    lastNoteMs: 60,
    medianNoteMs: 60,
    lastFirstRatio: null,
    loudestIndex: 0,
    fadeDb: 0,
    resonanceHz: 400,
    resonanceSlopeHzPerNote: null,
    flatness: 0.1,
    maxSqueakShare: 0.1,
    longNoteCount: 0,
    snrDb: 30,
  };
}

/** A deep copy of the shipped targets, for tests that break one entry at a time. */
function shippedCopy(): Record<string, any> {
  return structuredClone(targetsJson);
}

describe("scoreMeasure", () => {
  it("scores 100 anywhere inside the range, including its edges", () => {
    expect(scoreMeasure(300, SPACING_RANGE)).toBe(100);
    expect(scoreMeasure(230, SPACING_RANGE)).toBe(100);
    expect(scoreMeasure(370, SPACING_RANGE)).toBe(100);
  });

  it("falls off linearly to 0 over the tolerance, on either side", () => {
    expect(scoreMeasure(170, SPACING_RANGE)).toBe(50);
    expect(scoreMeasure(430, SPACING_RANGE)).toBe(50);
    expect(scoreMeasure(110, SPACING_RANGE)).toBe(0);
  });

  it("never goes below 0", () => {
    expect(scoreMeasure(100, SPACING_RANGE)).toBe(0);
    expect(scoreMeasure(5000, SPACING_RANGE)).toBe(0);
  });

  it("treats hi 999 as no upper limit", () => {
    const fade = { lo: 4, hi: 999, tolerance: 4 } as MeasureTarget;
    expect(scoreMeasure(40, fade)).toBe(100);
    expect(scoreMeasure(2, fade)).toBe(50);
  });
});

describe("scoreAttempt", () => {
  it("scores the hail_a recording 90 or better overall, as a whole number", () => {
    const scores = scoreAttempt(hailAMeasurements(), loadTargets("hail"));
    expect(scores.overall).toBeGreaterThanOrEqual(90);
    expect(Number.isInteger(scores.overall)).toBe(true);
  });

  it("makes rhythm the weakest sub-score and spacingMs the biggest loss when spacing is 141 ms", () => {
    const fast = { ...hailAMeasurements(), spacingMs: 141 };
    const scores = scoreAttempt(fast, loadTargets("hail"));

    const subValues = SUB_SCORES.flatMap((sub) => {
      const value = scores.subs[sub];
      return value === null ? [] : [{ sub, value }];
    });
    const weakest = subValues.reduce((a, b) => (b.value < a.value ? b : a));
    expect(weakest.sub).toBe("rhythm");

    const biggest = scores.measures.reduce((a, b) => (b.weightedLoss > a.weightedLoss ? b : a));
    expect(biggest.key).toBe("spacingMs");
  });

  it("computes weightedLoss as (100 - score) x measure weight x sub weight", () => {
    const fast = { ...hailAMeasurements(), spacingMs: 141 };
    const spacing = scoreAttempt(fast, loadTargets("hail")).measures.find((m) => m.key === "spacingMs");
    // spacingMs has weight 2 and sits in rhythm, whose sub weight is 2.
    expect(spacing?.value).toBe(141);
    expect(spacing?.score).toBeCloseTo(FAST_SPACING_SCORE, 10);
    expect(spacing?.weightedLoss).toBeCloseTo((100 - FAST_SPACING_SCORE) * 2 * 2, 10);
  });

  it("skips a null measurement rather than scoring it 0", () => {
    const base = hailAMeasurements();
    const scores = scoreAttempt({ ...base, spacingMs: 141, spacingCv: null }, loadTargets("hail"));

    const cv = scores.measures.find((m) => m.key === "spacingCv");
    expect(cv).toMatchObject({ value: null, score: null, weightedLoss: 0 });
    // Rhythm is now spacingMs alone.
    expect(scores.subs.rhythm).toBeCloseTo(FAST_SPACING_SCORE, 10);
  });

  it("takes a sub-score as the weighted mean of its measures", () => {
    const m = { ...hailAMeasurements(), spacingMs: 141, spacingCv: 0.25 };
    const scores = scoreAttempt(m, loadTargets("hail"));
    // spacingMs weight 2; spacingCv 0.25 is 0.1 above hi (0.15) with tolerance 0.25: scores 60, weight 1.
    expect(scores.subs.rhythm).toBeCloseTo((2 * FAST_SPACING_SCORE + 1 * 60) / 3, 10);
  });

  it("leaves pitch null for a chuckle and ignores it in the overall", () => {
    const chuckle = chuckleMeasurements();
    const scores = scoreAttempt(chuckle, loadTargets("chuckle"));
    expect(scores.subs.pitch).toBeNull();
    expect(scores.measures.some((m) => m.sub === "pitch")).toBe(false);
    expect(scores.overall).toBe(100);

    const wildPitch = scoreAttempt({ ...chuckle, resonanceHz: 99999 }, loadTargets("chuckle"));
    expect(wildPitch.overall).toBe(scores.overall);
  });

  it("ignores a sub-score with weight 0 in the overall (quack rhythm)", () => {
    const quack = { ...hailAMeasurements(), firstNoteMs: 250, resonanceHz: 1900, maxSqueakShare: 0.1 };
    const scores = scoreAttempt(quack, loadTargets("quack"));
    expect(scores.subs.rhythm).toBeNull();
    expect(scores.overall).toBe(100);
  });

  it("weights the overall by subWeights and rounds it to a whole number", () => {
    // Chuckle sub weights: rhythm 3, notes 2, tone 1. A 60 ms burst spacing is 40 below lo (100), tolerance 80: 50.
    const scores = scoreAttempt({ ...chuckleMeasurements(), burstSpacingMs: 60 }, loadTargets("chuckle"));
    expect(scores.subs.rhythm).toBe(50);
    expect(scores.overall).toBe(Math.round((3 * 50 + 2 * 100 + 1 * 100) / 6));
  });

  it("scores a slow chuckle (clicks over burstGapS apart) low on rhythm and says to roll faster", () => {
    const click = (startS: number) => ({
      startS,
      endS: startS + 0.06,
      durationMs: 60,
      peakDb: -20,
      resonanceHz: 2000,
      fundamentalHz: null,
      squeakShare: 0.1,
      flatness: 0.1,
    });
    const slow = measureCall([0, 0.3, 0.6, 0.9, 1.2, 1.5].map(click), -60);
    const scores = scoreAttempt(slow, loadTargets("chuckle"));
    expect(scores.subs.rhythm).not.toBeNull();
    expect(scores.subs.rhythm as number).toBeLessThan(20);
    expect(scores.overall).toBeLessThan(70);
    expect(selectTips("chuckle", scores).problems[0]).toBe(loadTips()["chuckle.burstSpacingMs.high"]);
  });

  it("reports an overall of 0 when nothing can be scored", () => {
    const targets = loadTargets("chuckle");
    const onlyBurst = { ...targets, measures: targets.measures.filter((t) => t.key === "burstSpacingMs") };
    const scores = scoreAttempt({ ...chuckleMeasurements(), burstSpacingMs: null }, onlyBurst);
    expect(scores.overall).toBe(0);
    expect(Object.values(scores.subs).every((s) => s === null)).toBe(true);
  });

  it("treats a sub-score whose measures all have weight 0 as unscored", () => {
    const targets = loadTargets("chuckle");
    const zeroed = { ...targets, measures: targets.measures.map((t) => ({ ...t, weight: 0 })) };
    const scores = scoreAttempt(chuckleMeasurements(), zeroed);
    expect(scores.subs.rhythm).toBeNull();
    expect(scores.overall).toBe(0);
  });
});

describe("loadTargets", () => {
  it.each(CALL_TYPES)("loads the shipped targets for %s", (callType: CallType) => {
    const targets = loadTargets(callType);
    expect(targets.callType).toBe(callType);
    expect(targets.measures.length).toBeGreaterThan(0);
    expect(targets.description.length).toBeGreaterThan(0);
  });

  it("returns the same cached object each time", () => {
    expect(loadTargets("hail")).toBe(loadTargets("hail"));
  });

  it("carries the confidence, measures and sub-weights from the table", () => {
    expect(loadTargets("hail").confidence).toBe("high");
    expect(loadTargets("comeback").confidence).toBe("low");
    expect(loadTargets("hail").measures).toHaveLength(9);
    expect(loadTargets("chuckle").subWeights).toEqual({ rhythm: 3, notes: 2, pitch: 0, tone: 1 });
  });
});

describe("parseTargets", () => {
  it("accepts the shipped targets", () => {
    const parsed = parseTargets(shippedCopy());
    expect(Object.keys(parsed).sort()).toEqual([...CALL_TYPES].sort());
  });

  it("rejects input that is not an object", () => {
    expect(() => parseTargets(null)).toThrow(/targets/);
    expect(() => parseTargets([])).toThrow(/targets/);
  });

  it("rejects an unknown call type, naming it", () => {
    const raw = shippedCopy();
    raw["whistle"] = raw["quack"];
    expect(() => parseTargets(raw)).toThrow(/whistle/);
  });

  it("rejects a missing call type, naming it", () => {
    const raw = shippedCopy();
    delete raw["chuckle"];
    expect(() => parseTargets(raw)).toThrow(/chuckle/);
  });

  it("rejects a bad confidence", () => {
    const raw = shippedCopy();
    raw["hail"].confidence = "certain";
    expect(() => parseTargets(raw)).toThrow(/hail.*confidence/);
  });

  it("rejects an empty description", () => {
    const raw = shippedCopy();
    raw["hail"].description = "";
    expect(() => parseTargets(raw)).toThrow(/hail.*description/);
  });

  it("rejects an invalid measure key, naming call type and key", () => {
    const raw = shippedCopy();
    raw["hail"].measures[0].key = "snrDb";
    expect(() => parseTargets(raw)).toThrow(/hail.*snrDb/);
  });

  it("rejects lo greater than hi", () => {
    const raw = shippedCopy();
    raw["hail"].measures[1].lo = 400;
    expect(() => parseTargets(raw)).toThrow(/hail.*spacingMs.*lo/);
  });

  it("rejects a tolerance of 0 or less", () => {
    const raw = shippedCopy();
    raw["quack"].measures[0].tolerance = 0;
    expect(() => parseTargets(raw)).toThrow(/quack.*firstNoteMs.*tolerance/);
  });

  it("rejects a negative weight", () => {
    const raw = shippedCopy();
    raw["quack"].measures[0].weight = -1;
    expect(() => parseTargets(raw)).toThrow(/quack.*firstNoteMs.*weight/);
  });

  it("rejects a sub-score that does not exist", () => {
    const raw = shippedCopy();
    raw["quack"].measures[0].sub = "volume";
    expect(() => parseTargets(raw)).toThrow(/quack.*firstNoteMs.*sub/);
  });

  it("rejects numbers that are missing or not numbers", () => {
    const stringLo = shippedCopy();
    stringLo["hail"].measures[0].lo = "4";
    expect(() => parseTargets(stringLo)).toThrow(/hail.*noteCount.*lo/);

    const nullHi = shippedCopy();
    nullHi["hail"].measures[0].hi = null;
    expect(() => parseTargets(nullHi)).toThrow(/hail.*noteCount.*hi/);
  });

  it("rejects numbers that are not finite", () => {
    const nan = shippedCopy();
    nan["hail"].measures[0].tolerance = Number.NaN;
    expect(() => parseTargets(nan)).toThrow(/hail.*noteCount.*tolerance/);

    const infinite = shippedCopy();
    infinite["hail"].measures[0].hi = Number.POSITIVE_INFINITY;
    expect(() => parseTargets(infinite)).toThrow(/hail.*noteCount.*hi/);

    const infiniteWeight = shippedCopy();
    infiniteWeight["hail"].subWeights.tone = Number.POSITIVE_INFINITY;
    expect(() => parseTargets(infiniteWeight)).toThrow(/hail.*subWeights.*tone/);
  });

  it("rejects a measure that is not an object", () => {
    const raw = shippedCopy();
    raw["hail"].measures[2] = 7;
    expect(() => parseTargets(raw)).toThrow(/hail/);
  });

  it("rejects a call type with no measures", () => {
    const raw = shippedCopy();
    raw["hail"].measures = [];
    expect(() => parseTargets(raw)).toThrow(/hail.*measures/);
  });

  it("rejects subWeights with a missing key", () => {
    const raw = shippedCopy();
    delete raw["chuckle"].subWeights.tone;
    expect(() => parseTargets(raw)).toThrow(/chuckle.*subWeights.*tone/);
  });

  it("rejects subWeights that are negative or not numbers", () => {
    const negative = shippedCopy();
    negative["chuckle"].subWeights.rhythm = -1;
    expect(() => parseTargets(negative)).toThrow(/chuckle.*subWeights.*rhythm/);

    const text = shippedCopy();
    text["chuckle"].subWeights.notes = "2";
    expect(() => parseTargets(text)).toThrow(/chuckle.*subWeights.*notes/);
  });
});
