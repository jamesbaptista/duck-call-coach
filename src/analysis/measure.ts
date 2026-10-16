import { ANALYSIS } from "../config/analysis";
import type { CallMeasurements, CallType, Note } from "./types";

const MS_PER_S = 1000;
/** Absorbs floating-point error in times built from frame counts. */
const TIME_EPSILON_S = 1e-9;
const TIME_EPSILON_MS = TIME_EPSILON_S * MS_PER_S;

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Median of a non-empty list (mean of the middle two for an even count). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Index of the first largest value. */
function indexOfMax(values: number[]): number {
  return values.reduce((best, value, i) => (value > values[best] ? i : best), 0);
}

/** Least-squares slope of `values` against their index (needs at least two values). */
function slopePerIndex(values: number[]): number {
  const meanIndex = (values.length - 1) / 2;
  const meanValue = mean(values);
  let covariance = 0;
  let variance = 0;
  values.forEach((value, i) => {
    covariance += (i - meanIndex) * (value - meanValue);
    variance += (i - meanIndex) ** 2;
  });
  return covariance / variance;
}

function loudestPeakDb(notes: Note[]): number {
  return notes.reduce((loudest, note) => Math.max(loudest, note.peakDb), -Infinity);
}

/** Signal-to-noise: the loudest note's peak above the noise floor. */
export function snrDb(notes: Note[], floorDb: number): number {
  return loudestPeakDb(notes) - floorDb;
}

/** Onset-to-onset spacing of neighbouring notes, in ms. */
function onsetGapsMs(notes: Note[]): number[] {
  return notes.slice(1).map((note, i) => (note.startS - notes[i].startS) * MS_PER_S);
}

/** Mean spacing and its coefficient of variation (population std / mean); null under two notes. */
function spacingStats(gapsMs: number[]): Pick<CallMeasurements, "spacingMs" | "spacingCv"> {
  if (gapsMs.length === 0) return { spacingMs: null, spacingCv: null };
  const spacingMs = mean(gapsMs);
  const std = Math.sqrt(mean(gapsMs.map((gap) => (gap - spacingMs) ** 2)));
  return { spacingMs, spacingCv: std / spacingMs };
}

/**
 * Median of the spacings shorter than burstGapS (notes inside a chuckle burst). When no gap is that short the
 * clicks never formed a burst, so it falls back to the median of all gaps, letting a slow chuckle score as slow.
 * Null under two notes.
 */
function burstSpacingMs(gapsMs: number[]): number | null {
  if (gapsMs.length === 0) return null;
  const inBurst = gapsMs.filter((gap) => gap < ANALYSIS.burstGapS * MS_PER_S - TIME_EPSILON_MS);
  return median(inBurst.length ? inBurst : gapsMs);
}

/** Largest measured squeak share; 0 when no note was loud enough to be measured. */
function maxSqueakShare(notes: Note[]): number {
  return notes.reduce((best, note) => Math.max(best, note.squeakShare ?? 0), 0);
}

function longNoteCount(durationsMs: number[]): number {
  return durationsMs.filter((duration) => duration > ANALYSIS.longNoteMs + TIME_EPSILON_MS).length;
}

/** Call-level measurements of a non-empty, time-ordered run of notes (spec section 4, item 7). */
export function measureCall(notes: Note[], floorDb: number): CallMeasurements {
  if (notes.length === 0) throw new RangeError("measureCall needs at least one note");
  const gapsMs = onsetGapsMs(notes);
  const durationsMs = notes.map((note) => note.durationMs);
  const peaksDb = notes.map((note) => note.peakDb);
  const resonancesHz = notes.map((note) => note.resonanceHz);
  const loudestIndex = indexOfMax(peaksDb);
  const firstNoteMs = durationsMs[0];
  const lastNoteMs = durationsMs[durationsMs.length - 1];
  return {
    noteCount: notes.length,
    ...spacingStats(gapsMs),
    burstSpacingMs: burstSpacingMs(gapsMs),
    firstNoteMs,
    lastNoteMs,
    medianNoteMs: median(durationsMs),
    lastFirstRatio: notes.length < 2 ? null : lastNoteMs / firstNoteMs,
    loudestIndex,
    fadeDb: peaksDb[loudestIndex] - peaksDb[peaksDb.length - 1],
    resonanceHz: median(resonancesHz),
    resonanceSlopeHzPerNote: notes.length < ANALYSIS.minSlopeNotes ? null : slopePerIndex(resonancesHz),
    flatness: median(notes.map((note) => note.flatness)),
    maxSqueakShare: maxSqueakShare(notes),
    longNoteCount: longNoteCount(durationsMs),
    snrDb: snrDb(notes, floorDb),
  };
}

/** Groups time-ordered notes into calls, starting a new one after more than sequenceGapS of silence. */
export function buildSequences(notes: Note[]): Note[][] {
  const sequences: Note[][] = [];
  for (const note of notes) {
    const current = sequences[sequences.length - 1];
    const previous = current?.[current.length - 1];
    if (previous && note.startS - previous.endS <= ANALYSIS.sequenceGapS + TIME_EPSILON_S) {
      current.push(note);
    } else {
      sequences.push([note]);
    }
  }
  return sequences;
}

/** True when `candidate` should be scored instead of `best`: more notes, or as many and louder. */
function beats(candidate: Note[], best: Note[]): boolean {
  if (candidate.length !== best.length) return candidate.length > best.length;
  return loudestPeakDb(candidate) > loudestPeakDb(best);
}

/**
 * The notes to score: for a quack the loudest note overall; otherwise the sequence with the most notes,
 * ties going to the loudest. Empty when there are no notes.
 */
export function pickScored(sequences: Note[][], callType: CallType): Note[] {
  if (callType === "quack") {
    const all = sequences.flat();
    return all.length ? [all[indexOfMax(all.map((note) => note.peakDb))]] : [];
  }
  return sequences.reduce((best, sequence) => (beats(sequence, best) ? sequence : best), [] as Note[]);
}
