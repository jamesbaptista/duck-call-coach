import type { QualityIssue } from "../../../analysis/types";
import { pairNotes } from "../../../scoring/reference";
import { loadTargets } from "../../../scoring/score";
import type { Confidence } from "../../../scoring/types";
import type { AttemptRecord, ReferenceRecord } from "../../../storage/db";
import { chooseTargets, isAnalysisFailed } from "../../attempt";
import type { ChartPair } from "../../charts/notesChart";
import { builtInShape, referenceShape, type ShapeNote } from "../../charts/targetShape";

/** What the Results screen shows, worked out without the DOM. */

/** Shown instead of scores when the recording couldn't be judged. */
export const QUALITY_MESSAGES: Record<QualityIssue, string> = {
  clipped: "Too loud. Hold the phone further from the call.",
  too_quiet: "Too quiet or too noisy to judge. Get closer or find a quieter spot.",
  no_notes: "Didn't hear a call.",
  too_few_notes: "Didn't hear a full call. Try the whole call.",
};

export const PROCESSING_ON_NOTE = "Your phone may be cleaning up the sound, so tone scores are less reliable.";
export const REFERENCE_INACTIVE_NOTE = "That reference is no longer active, so this shows the built-in target.";
export const ANALYSIS_UNFINISHED_TEXT = "We couldn't finish analysing this recording.";
export const NOT_FOUND_TEXT = "We couldn't find that attempt.";

/** A sub-score as a whole number, or a dash when none of its measures could be taken. */
export function subScoreText(score: number | null): string {
  return score === null ? "–" : String(Math.round(score));
}

/** The reference the attempt was scored against, if it still exists. Notes draw it; measurements score it. */
export type ResultsReference = Pick<ReferenceRecord, "notes" | "measurements">;

/** Which reference the Results screen loads to draw and replay an attempt's target. */
export type ReferenceLookup = { kind: "none" } | { kind: "id"; id: string } | { kind: "active" };

/**
 * The reference an attempt was scored against, found by the id saved with it, even if another one is active now.
 * An attempt saved before ids were kept falls back to the active reference. Built-in and failed attempts need none.
 */
export function referenceLookup(
  attempt: Pick<AttemptRecord, "targetSource" | "referenceId" | "analysis" | "scores">,
): ReferenceLookup {
  if (attempt.targetSource !== "reference" || isAnalysisFailed(attempt)) return { kind: "none" };
  return attempt.referenceId === undefined ? { kind: "active" } : { kind: "id", id: attempt.referenceId };
}

export interface ChartTarget {
  shape: ShapeNote[];
  pairs: ChartPair[];
  /** True when the shape is the user's reference rather than the built-in hen target. */
  usesReference: boolean;
  /**
   * The attempt was scored against a reference that can't be found any more (it was deleted, or for an attempt saved
   * without its reference's id, none is active), so the built-in shape stands in.
   */
  referenceInactive: boolean;
}

/** The target shape the chart draws behind the attempt, and in reference mode how the notes pair up. */
export function chartTarget(
  attempt: Pick<AttemptRecord, "callType" | "targetSource" | "analysis">,
  reference: Pick<ReferenceRecord, "notes"> | undefined,
): ChartTarget {
  const scoredOnReference = attempt.targetSource === "reference";
  if (scoredOnReference && reference) {
    return {
      shape: referenceShape(reference.notes),
      pairs: pairNotes(attempt.analysis.notes, reference.notes),
      usesReference: true,
      referenceInactive: false,
    };
  }
  return {
    shape: builtInShape(loadTargets(attempt.callType)),
    pairs: [],
    usesReference: false,
    referenceInactive: scoredOnReference,
  };
}

/** How sure the app is about the targets shown: the reference's when the attempt used one that still exists. */
export function resultsConfidence(
  attempt: Pick<AttemptRecord, "callType" | "targetSource">,
  reference: ResultsReference | undefined,
): Confidence {
  if (attempt.targetSource === "reference" && reference) {
    return chooseTargets(attempt.callType, reference, null).confidence;
  }
  return loadTargets(attempt.callType).confidence;
}

function notes(count: number): string {
  return count === 1 ? "1 note" : `${count} notes`;
}

/** The chart's text alternative for screen readers. */
export function chartDescription(counts: {
  attemptNotes: number;
  targetNotes: number;
  unmatched: number;
  usesReference: boolean;
}): string {
  const target = counts.usesReference ? "your reference's" : "the hen target's";
  const pitch = counts.usesReference
    ? "Dots show your notes' pitch and rings your reference's, on a 1 to 3 kHz scale;"
    : "Dots show your notes' pitch on a 1 to 3 kHz scale;";
  const parts = [
    `Your ${notes(counts.attemptNotes)}, drawn over ${target} ${notes(counts.targetNotes)}.`,
    "Time runs left to right and loudness bottom to top.",
    `${pitch} the shaded band is a hen's pitch, 1.8 to 2.1 kHz.`,
  ];
  if (counts.unmatched > 0) {
    parts.push(`${notes(counts.unmatched)} ${counts.unmatched === 1 ? "has" : "have"} no partner.`);
  }
  return parts.join(" ");
}
