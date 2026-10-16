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
  REFERENCE_INACTIVE_NOTE,
  referenceLookup,
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

describe("REFERENCE_INACTIVE_NOTE", () => {
  it("is true whether the reference was deleted or switched off", () => {
    expect(REFERENCE_INACTIVE_NOTE).toBe("That reference is no longer active, so this shows the built-in target.");
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
      referenceInactive: false,
    });
  });

  it("draws the reference's notes, paired with the attempt's, in reference mode", () => {
    const target = chartTarget({ callType: "hail", targetSource: "reference", analysis: HAIL_A }, REFERENCE);
    expect(target).toEqual({
      shape: referenceShape(HAIL_B.notes),
      pairs: pairNotes(HAIL_A.notes, HAIL_B.notes),
      usesReference: true,
      referenceInactive: false,
    });
  });

  it("falls back to the built-in shape when the reference is no longer active", () => {
    const target = chartTarget({ callType: "hail", targetSource: "reference", analysis: HAIL_A }, undefined);
    expect(target).toEqual({
      shape: builtInShape(loadTargets("hail")),
      pairs: [],
      usesReference: false,
      referenceInactive: true,
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

  it("falls back to the built-in confidence when the reference is no longer active", () => {
    expect(resultsConfidence({ callType: "chuckle", targetSource: "reference" }, undefined)).toBe("low");
  });
});

describe("chartDescription", () => {
  it("says what is drawn, for screen readers", () => {
    expect(chartDescription({ attemptNotes: 5, targetNotes: 6, unmatched: 0, usesReference: false })).toBe(
      "Your 5 notes, drawn over the hen target's 6 notes. Time runs left to right and loudness bottom to top. " +
        "Dots show your notes' pitch on a 1 to 3 kHz scale; the shaded band is a hen's pitch, 1.8 to 2.1 kHz.",
    );
  });

  it("uses singulars and counts the notes without a partner", () => {
    expect(chartDescription({ attemptNotes: 1, targetNotes: 1, unmatched: 1, usesReference: true })).toBe(
      "Your 1 note, drawn over your reference's 1 note. Time runs left to right and loudness bottom to top. " +
        "Dots show your notes' pitch and rings your reference's, on a 1 to 3 kHz scale; " +
        "the shaded band is a hen's pitch, 1.8 to 2.1 kHz. 1 note has no partner.",
    );
    expect(chartDescription({ attemptNotes: 4, targetNotes: 6, unmatched: 2, usesReference: true })).toContain(
      "2 notes have no partner.",
    );
  });
});

describe("referenceLookup", () => {
  const judged = { analysis: HAIL_A, scores: null };

  it("looks up the reference the attempt was scored against by its id", () => {
    expect(referenceLookup({ ...judged, targetSource: "reference", referenceId: "r1" })).toEqual({ kind: "id", id: "r1" });
  });

  it("falls back to the active reference for an older attempt saved without an id", () => {
    expect(referenceLookup({ ...judged, targetSource: "reference" })).toEqual({ kind: "active" });
  });

  it("looks up nothing for an attempt scored against the built-in target", () => {
    expect(referenceLookup({ ...judged, targetSource: "builtin" })).toEqual({ kind: "none" });
  });

  it("looks up nothing for an attempt whose analysis failed", () => {
    const failed = { ...HAIL_A, notes: [], measurements: null, quality: null };
    expect(referenceLookup({ analysis: failed, scores: null, targetSource: "reference", referenceId: "r1" })).toEqual({
      kind: "none",
    });
  });
});
