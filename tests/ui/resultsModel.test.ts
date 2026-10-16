import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/analyze";
import type { AnalysisResult, CallMeasurements } from "../../src/analysis/types";
import { pairNotes } from "../../src/scoring/reference";
import { loadTargets } from "../../src/scoring/score";
import { builtInShape, referenceShape } from "../../src/ui/charts/targetShape";
import {
  chartDescription,
  chartTarget,
  QUALITY_MESSAGES,
  resultsConfidence,
  subScoreText,
} from "../../src/ui/screens/results/model";
import { readWav } from "../helpers/wav";

const hailA = readWav("tests/fixtures/hail_a.wav");
const hailB = readWav("tests/fixtures/hail_b.wav");
const HAIL_A: AnalysisResult = analyze(hailA.samples, hailA.sampleRate, "hail");
const HAIL_B: AnalysisResult = analyze(hailB.samples, hailB.sampleRate, "hail");

function measured(analysis: AnalysisResult): CallMeasurements {
  if (analysis.measurements === null) throw new Error("expected measurements");
  return analysis.measurements;
}

const REFERENCE = { notes: HAIL_B.notes, measurements: measured(HAIL_B) };

describe("QUALITY_MESSAGES", () => {
  it("says why each kind of recording couldn't be judged", () => {
    expect(QUALITY_MESSAGES).toEqual({
      clipped: "Too loud. Hold the phone further from the call.",
      too_quiet: "Too quiet or too noisy to judge. Get closer or find a quieter spot.",
      no_notes: "Didn't hear a call.",
      too_few_notes: "Didn't hear a full call. Try the whole call.",
    });
  });
});

describe("subScoreText", () => {
  it("rounds a sub-score and shows a dash when there is none", () => {
    expect(subScoreText(86.6)).toBe("87");
    expect(subScoreText(86.4)).toBe("86");
    expect(subScoreText(0)).toBe("0");
    expect(subScoreText(null)).toBe("–");
  });
});

describe("chartTarget", () => {
  it("draws the built-in shape for a built-in attempt, even if a reference is active now", () => {
    const target = chartTarget({ callType: "hail", targetSource: "builtin", analysis: HAIL_A }, REFERENCE);
    expect(target).toEqual({
      shape: builtInShape(loadTargets("hail")),
      pairs: [],
      usesReference: false,
      referenceDeleted: false,
    });
  });

  it("draws the reference's notes, paired with the attempt's, in reference mode", () => {
    const target = chartTarget({ callType: "hail", targetSource: "reference", analysis: HAIL_A }, REFERENCE);
    expect(target).toEqual({
      shape: referenceShape(HAIL_B.notes),
      pairs: pairNotes(HAIL_A.notes, HAIL_B.notes),
      usesReference: true,
      referenceDeleted: false,
    });
  });

  it("falls back to the built-in shape when the reference has been deleted", () => {
    const target = chartTarget({ callType: "hail", targetSource: "reference", analysis: HAIL_A }, undefined);
    expect(target).toEqual({
      shape: builtInShape(loadTargets("hail")),
      pairs: [],
      usesReference: false,
      referenceDeleted: true,
    });
  });
});

describe("resultsConfidence", () => {
  it("is the built-in target's confidence for a built-in attempt", () => {
    expect(resultsConfidence({ callType: "comeback", targetSource: "builtin" }, undefined)).toBe("low");
    expect(resultsConfidence({ callType: "comeback", targetSource: "builtin" }, REFERENCE)).toBe("low");
  });

  it("is the reference targets' confidence in reference mode", () => {
    expect(resultsConfidence({ callType: "comeback", targetSource: "reference" }, REFERENCE)).toBe("high");
  });

  it("falls back to the built-in confidence when the reference has been deleted", () => {
    expect(resultsConfidence({ callType: "chuckle", targetSource: "reference" }, undefined)).toBe("low");
  });
});

describe("chartDescription", () => {
  it("says what is drawn, for screen readers", () => {
    expect(chartDescription({ attemptNotes: 5, targetNotes: 6, unmatched: 0, usesReference: false })).toBe(
      "Your 5 notes, drawn over the hen target's 6 notes. Time runs left to right and loudness bottom to top.",
    );
  });

  it("uses singulars and counts the notes without a partner", () => {
    expect(chartDescription({ attemptNotes: 1, targetNotes: 1, unmatched: 1, usesReference: true })).toBe(
      "Your 1 note, drawn over your reference's 1 note. Time runs left to right and loudness bottom to top. " +
        "1 note has no partner.",
    );
    expect(chartDescription({ attemptNotes: 4, targetNotes: 6, unmatched: 2, usesReference: true })).toContain(
      "2 notes have no partner.",
    );
  });
});
