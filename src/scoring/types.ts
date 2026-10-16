import type { CallMeasurements, CallType } from "../analysis/types";

export type SubScore = "rhythm" | "notes" | "pitch" | "tone";

/** The measurements a call can be scored on (snrDb is a quality gate; lastNoteMs is only used for the ratio). */
export type MeasureKey = keyof Omit<CallMeasurements, "snrDb" | "lastNoteMs">;

export type Confidence = "high" | "medium" | "low";

export interface MeasureTarget {
  key: MeasureKey;
  /** Values from lo to hi (inclusive) score 100. */
  lo: number;
  /** An upper limit of NO_UPPER_LIMIT means there is none. */
  hi: number;
  /** How far outside the range a value can be before its score reaches 0. Same unit as the measure. */
  tolerance: number;
  weight: number;
  sub: SubScore;
}

export interface CallTargets {
  callType: CallType;
  confidence: Confidence;
  description: string;
  measures: MeasureTarget[];
  subWeights: Record<SubScore, number>;
}

export interface MeasureScore {
  key: MeasureKey;
  sub: SubScore;
  /** Null when the measurement could not be taken for this recording. */
  value: number | null;
  lo: number;
  hi: number;
  /** Null when `value` is null; such a measure is skipped. */
  score: number | null;
  /** How many points this measure cost the overall score; larger means a better tip target. */
  weightedLoss: number;
}

export interface Scores {
  /** Whole number, 0 to 100. */
  overall: number;
  /** Null when no measure of that sub-score could be taken. */
  subs: Record<SubScore, number | null>;
  measures: MeasureScore[];
}

export const SUB_SCORES: readonly SubScore[] = ["rhythm", "notes", "pitch", "tone"];
export const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];
export const CALL_TYPES: readonly CallType[] = ["quack", "hail", "comeback", "chuckle"];

/** Every MeasureKey; the Record type makes the compiler flag a key missing from this list. */
const MEASURE_KEY_FLAGS: Record<MeasureKey, true> = {
  noteCount: true,
  spacingMs: true,
  spacingCv: true,
  burstSpacingMs: true,
  firstNoteMs: true,
  medianNoteMs: true,
  lastFirstRatio: true,
  loudestIndex: true,
  fadeDb: true,
  resonanceHz: true,
  resonanceSlopeHzPerNote: true,
  flatness: true,
  maxSqueakShare: true,
  longNoteCount: true,
};
export const MEASURE_KEYS = Object.keys(MEASURE_KEY_FLAGS) as MeasureKey[];

/** The `hi` value in targets.json that means "no upper limit". */
export const NO_UPPER_LIMIT = 999;
