export type CallType = "quack" | "hail" | "comeback" | "chuckle";

/** A run of analysis frames holding one note. `endFrame` is exclusive. */
export interface NoteSpan {
  startFrame: number;
  endFrame: number;
}

/** One detected note, measured on the high-passed signal. Times in seconds from the start of the recording. */
export interface Note {
  startS: number;
  endS: number;
  durationMs: number;
  peakDb: number;
  resonanceHz: number;
  fundamentalHz: number | null;
  /** Null when the note is more than squeakSkipBelowDb quieter than the loudest note in the recording. */
  squeakShare: number | null;
  flatness: number;
}

/** Call-level measurements of the scored notes (spec section 4, item 7). */
export interface CallMeasurements {
  noteCount: number;
  spacingMs: number | null;
  spacingCv: number | null;
  burstSpacingMs: number | null;
  firstNoteMs: number;
  lastNoteMs: number;
  medianNoteMs: number;
  lastFirstRatio: number | null;
  loudestIndex: number;
  fadeDb: number;
  resonanceHz: number;
  resonanceSlopeHzPerNote: number | null;
  flatness: number;
  maxSqueakShare: number;
  longNoteCount: number;
  snrDb: number;
}

export type QualityIssue = "clipped" | "too_quiet" | "no_notes" | "too_few_notes";

export interface AnalysisResult {
  callType: CallType;
  analyzerVersion: string;
  noiseFloorDb: number;
  /** The scored notes: the ones `measurements` describes. */
  notes: Note[];
  measurements: CallMeasurements | null;
  quality: QualityIssue | null;
}
