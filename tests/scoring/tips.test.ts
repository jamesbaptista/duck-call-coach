import { describe, expect, it } from "vitest";
import type { CallMeasurements } from "../../src/analysis/types";
import { loadTargets, scoreAttempt } from "../../src/scoring/score";
import { directionOf, formatValue, loadTips, parseTips, selectTips } from "../../src/scoring/tips";
import tipsJson from "../../src/scoring/tips.json";
import { CALL_TYPES, MEASURE_KEYS, NO_UPPER_LIMIT, SUB_SCORES } from "../../src/scoring/types";
import type { MeasureKey, MeasureScore, Scores, SubScore } from "../../src/scoring/types";

/** A hail with every measurement inside its target range. */
function perfectHail(): CallMeasurements {
  return {
    noteCount: 6,
    spacingMs: 300,
    spacingCv: 0.05,
    burstSpacingMs: null,
    firstNoteMs: 250,
    lastNoteMs: 120,
    medianNoteMs: 180,
    lastFirstRatio: 0.5,
    loudestIndex: 0,
    fadeDb: 8,
    resonanceHz: 2000,
    resonanceSlopeHzPerNote: -20,
    flatness: 0.1,
    maxSqueakShare: 0.1,
    longNoteCount: 0,
    snrDb: 30,
  };
}

/** Weighted losses: spacingMs low 297, fadeDb low 188, maxSqueakShare high 100, spacingCv high 40. */
function troubledHail(): Scores {
  const m = { ...perfectHail(), spacingMs: 141, fadeDb: 1.5, maxSqueakShare: 1, spacingCv: 0.2 };
  return scoreAttempt(m, loadTargets("hail"));
}

function measure(key: MeasureKey, value: number | null, range: { lo: number; hi: number }, weightedLoss: number): MeasureScore {
  return { key, sub: "notes", value, ...range, score: value === null ? null : 50, weightedLoss };
}

function scoresOf(measures: MeasureScore[]): Scores {
  return { overall: 50, subs: { rhythm: 50, notes: 50, pitch: 50, tone: 50 }, measures };
}

function scoresWithSubs(subs: Record<SubScore, number | null>): Scores {
  return { overall: 50, subs, measures: [] };
}

const SPACING_LOW = "Your notes are 141 ms apart; a hen's are 230-370 ms. Slow down and give each note its own 'quack'.";
const FADE_LOW = "Your last note is nearly as loud as your loudest. Ease off the air so each note gets softer.";
const SQUEAK_HIGH =
  "There's a squeak in your call. That usually means too much air or a pinched reed: back off the air and keep your hand relaxed.";

describe("selectTips", () => {
  it("turns the three biggest losses into tips, largest first, with numbers filled in", () => {
    const { problems } = selectTips("hail", troubledHail());
    expect(problems).toEqual([SPACING_LOW, FADE_LOW, SQUEAK_HIGH]);
  });

  it("gives no problems and a positive message for a perfect call", () => {
    const scores = scoreAttempt(perfectHail(), loadTargets("hail"));
    const { problems, positive } = selectTips("hail", scores);
    expect(problems).toEqual([]);
    expect(positive).toBe("Your pace is steady. Keep that rhythm.");
  });

  it("prefers a call-specific tip over the any.* one", () => {
    const scores = scoresOf([measure("spacingMs", 400, { lo: 150, hi: 250 }, 10)]);
    expect(selectTips("comeback", scores).problems).toEqual([
      "Your comeback is too slow (400 ms between notes). Make it urgent: 150-250 ms.",
    ]);
    expect(selectTips("hail", scores).problems).toEqual(["Your notes are 400 ms apart; aim for 150-250 ms. Keep the call moving."]);
  });

  it("skips measures that are in range, unmeasured, lost nothing, or have no tip", () => {
    const scores = scoresOf([
      measure("spacingMs", 300, { lo: 230, hi: 370 }, 5),
      measure("spacingCv", null, { lo: 0, hi: 0.15 }, 5),
      measure("noteCount", 1, { lo: 4, hi: 10 }, 0),
      measure("burstSpacingMs", 500, { lo: 100, hi: 165 }, 9),
      measure("fadeDb", 1, { lo: 4, hi: NO_UPPER_LIMIT }, 1),
    ]);
    expect(selectTips("hail", scores).problems).toEqual([FADE_LOW]);
  });

  it("keeps the order of equal losses and returns at most three", () => {
    const scores = scoresOf([
      measure("noteCount", 1, { lo: 4, hi: 10 }, 7),
      measure("spacingCv", 0.5, { lo: 0, hi: 0.15 }, 7),
      measure("maxSqueakShare", 0.9, { lo: 0, hi: 0.8 }, 7),
      measure("lastFirstRatio", 0.9, { lo: 0.3, hi: 0.7 }, 7),
    ]);
    const { problems } = selectTips("hail", scores);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toBe("You used 1 notes; aim for 4-10.");
    expect(problems[2]).toBe(SQUEAK_HIGH);
  });

  it("formats the loudest note as an ordinal", () => {
    const scores = scoresOf([measure("loudestIndex", 3, { lo: 0, hi: 1 }, 4)]);
    expect(selectTips("hail", scores).problems).toEqual([
      "Your loudest note came late (your 4th note). Hit the first notes hardest, then taper off.",
    ]);
  });
});

describe("positive message", () => {
  it("comes from the highest sub-score", () => {
    expect(selectTips("hail", scoresWithSubs({ rhythm: 60, notes: 70, pitch: 95, tone: 80 })).positive).toBe(
      "Your pitch sits right where a hen's does.",
    );
  });

  it("breaks ties in the order rhythm, notes, pitch, tone", () => {
    expect(selectTips("hail", scoresWithSubs({ rhythm: 80, notes: 80, pitch: 80, tone: 80 })).positive).toBe(
      "Your pace is steady. Keep that rhythm.",
    );
    expect(selectTips("hail", scoresWithSubs({ rhythm: 70, notes: 90, pitch: 90, tone: 90 })).positive).toBe(
      "Good note count and shape.",
    );
  });

  it("ignores subs that could not be scored, and is empty when none could", () => {
    expect(selectTips("hail", scoresWithSubs({ rhythm: null, notes: null, pitch: null, tone: 10 })).positive).toBe(
      "Clean tone with no squeaks. Nice.",
    );
    expect(selectTips("hail", scoresWithSubs({ rhythm: null, notes: null, pitch: null, tone: null })).positive).toBe("");
  });
});

describe("directionOf", () => {
  const range = { lo: 10, hi: 20 };
  it("is low below lo, high above hi, and null inside or without a value", () => {
    expect(directionOf({ ...range, value: 5 })).toBe("low");
    expect(directionOf({ ...range, value: 25 })).toBe("high");
    expect(directionOf({ ...range, value: 10 })).toBeNull();
    expect(directionOf({ ...range, value: 20 })).toBeNull();
    expect(directionOf({ ...range, value: null })).toBeNull();
  });
});

describe("formatValue", () => {
  it.each([
    ["spacingMs", 140.6, "141"],
    ["burstSpacingMs", 99.4, "99"],
    ["firstNoteMs", 250, "250"],
    ["medianNoteMs", 29.5, "30"],
    ["resonanceHz", 2450, "2.5 kHz"],
    ["resonanceHz", 1800, "1.8 kHz"],
    ["resonanceSlopeHzPerNote", -45.4, "-45"],
    ["fadeDb", 3.4, "3"],
    ["spacingCv", 0.1234, "0.12"],
    ["lastFirstRatio", 0.5, "0.50"],
    ["flatness", 0.056, "0.06"],
    ["maxSqueakShare", 1, "1.00"],
    ["noteCount", 6, "6"],
    ["longNoteCount", 2, "2"],
  ] as [MeasureKey, number, string][])("formats %s %d as %s", (key, n, expected) => {
    expect(formatValue(key, n)).toBe(expected);
  });

  it.each([
    [0, "1st"],
    [1, "2nd"],
    [2, "3rd"],
    [3, "4th"],
    [10, "11th"],
    [11, "12th"],
    [12, "13th"],
    [20, "21st"],
    [21, "22nd"],
    [22, "23rd"],
  ])("shows loudestIndex %d as the %s note", (index, ordinal) => {
    expect(formatValue("loudestIndex", index)).toBe(ordinal);
  });

  it("covers every measurement", () => {
    for (const key of MEASURE_KEYS) expect(formatValue(key, 1)).not.toBe("");
  });
});

describe("parseTips", () => {
  it("accepts the shipped table", () => {
    expect(parseTips(tipsJson)).toEqual(tipsJson);
    expect(loadTips()).toEqual(tipsJson);
  });

  it("rejects things that are not an object of strings", () => {
    expect(() => parseTips(null)).toThrow(/object/);
    expect(() => parseTips([])).toThrow(/object/);
    expect(() => parseTips({ "any.spacingMs.low": 5 })).toThrow(/any\.spacingMs\.low/);
    expect(() => parseTips({ "any.spacingMs.low": "  " })).toThrow(/any\.spacingMs\.low/);
  });

  it("rejects placeholders other than {value}, {lo} and {hi}", () => {
    expect(() => parseTips({ a: "ok {value} {lo} {hi}" })).not.toThrow();
    expect(() => parseTips({ a: "bad {valeu}" })).toThrow(/\{valeu\}/);
    expect(() => parseTips({ a: "bad {}" })).toThrow(/\{\}/);
    expect(() => parseTips({ a: "stray { brace" })).toThrow(/brace/);
  });
});

describe("tip coverage", () => {
  const tips = loadTips();

  function reachable(lo: number, hi: number): ("low" | "high")[] {
    const dirs: ("low" | "high")[] = [];
    if (lo !== 0) dirs.push("low");
    if (hi < NO_UPPER_LIMIT) dirs.push("high");
    return dirs;
  }

  it("has text for every reachable (call type, measure, direction) in targets.json", () => {
    for (const callType of CALL_TYPES) {
      for (const { key, lo, hi } of loadTargets(callType).measures) {
        for (const dir of reachable(lo, hi)) {
          const text = tips[`${callType}.${key}.${dir}`] ?? tips[`any.${key}.${dir}`];
          expect(text, `${callType}.${key}.${dir}`).toBeTruthy();
        }
      }
    }
  });

  it("has text for the rasp (flatness) target both ways", () => {
    expect(tips["any.flatness.low"]).toBeTruthy();
    expect(tips["any.flatness.high"]).toBeTruthy();
  });

  it("never shows {hi} for a target with no upper limit", () => {
    for (const callType of CALL_TYPES) {
      for (const { key, hi } of loadTargets(callType).measures) {
        if (hi !== NO_UPPER_LIMIT) continue;
        for (const dir of ["low", "high"]) {
          for (const tip of [tips[`${callType}.${key}.${dir}`], tips[`any.${key}.${dir}`]]) {
            expect(tip ?? "", `${callType}.${key}.${dir}`).not.toContain("{hi}");
          }
        }
      }
    }
  });

  it("only names call types, measures and directions that exist", () => {
    const sections: readonly string[] = [...CALL_TYPES, "any"];
    for (const name of Object.keys(tips)) {
      const [section = "", key = "", dir = ""] = name.split(".");
      if (section === "positive") {
        expect(SUB_SCORES as readonly string[], name).toContain(key);
        continue;
      }
      expect(sections, name).toContain(section);
      expect(MEASURE_KEYS as string[], name).toContain(key);
      expect(["low", "high"], name).toContain(dir);
    }
  });
});
