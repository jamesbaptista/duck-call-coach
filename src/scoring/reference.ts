import type { CallMeasurements, Note } from "../analysis/types";
import type { CallTargets, MeasureKey, MeasureTarget } from "./types";

/** Reference ranges are the reference's own value plus or minus these margins. */
const PERCENT_BANDS: Partial<Record<MeasureKey, number>> = {
  spacingMs: 0.15,
  firstNoteMs: 0.2,
  medianNoteMs: 0.2,
};
const NOTE_COUNT_MARGIN = 1;
const RESONANCE_MARGIN_HZ = 150;
const FADE_MARGIN_DB = 4;

const FLATNESS_LO_FACTOR = 0.6;
const FLATNESS_HI_FACTOR = 1.4;
const FLATNESS_TOLERANCE_FACTOR = 0.6;

/** Neutral resonance used when a note has none, so it matches the middle of the feature scale. */
const RESONANCE_CENTER_HZ = 2000;
const RESONANCE_SCALE_HZ = 500;
const PEAK_DB_SCALE = 10;

type Band = { lo: number; hi: number };
type NoteFeatures = readonly [number, number, number, number];
export type NotePair = [number | null, number | null];

function referenceBand(key: MeasureKey, value: number): Band | null {
  const percent = PERCENT_BANDS[key];
  if (percent !== undefined) return { lo: value * (1 - percent), hi: value * (1 + percent) };
  switch (key) {
    case "noteCount":
      return { lo: Math.max(1, value - NOTE_COUNT_MARGIN), hi: value + NOTE_COUNT_MARGIN };
    case "resonanceHz":
      return { lo: value - RESONANCE_MARGIN_HZ, hi: value + RESONANCE_MARGIN_HZ };
    case "fadeDb":
      return { lo: Math.max(0, value - FADE_MARGIN_DB), hi: value + FADE_MARGIN_DB };
    default:
      return null;
  }
}

/**
 * Replaces the built-in ranges with ranges built around the user's reference recording.
 * Returns new objects; the input (often the cached result of `loadTargets`) is never changed.
 */
export function targetsFromReference(builtIn: CallTargets, ref: CallMeasurements): CallTargets {
  const measures = builtIn.measures.map((target): MeasureTarget => {
    const value = ref[target.key];
    if (typeof value !== "number" || !Number.isFinite(value)) return target;
    const band = referenceBand(target.key, value);
    return band === null ? target : { ...target, lo: band.lo, hi: band.hi };
  });
  return { ...builtIn, confidence: "high", measures };
}

/**
 * Adds a rasp (flatness) target built around a baseline: the reference's flatness or the user's best attempt.
 * Rasp has no built-in range. An unusable baseline returns the targets unchanged.
 */
export function withFlatnessBaseline(t: CallTargets, baseline: number | null): CallTargets {
  if (baseline === null || !Number.isFinite(baseline) || baseline <= 0) return t;
  const flatness: MeasureTarget = {
    key: "flatness",
    lo: FLATNESS_LO_FACTOR * baseline,
    hi: FLATNESS_HI_FACTOR * baseline,
    tolerance: FLATNESS_TOLERANCE_FACTOR * baseline,
    weight: 1,
    sub: "tone",
  };
  return { ...t, measures: [...t.measures.filter((m) => m.key !== "flatness"), flatness] };
}

function noteFeatures(notes: readonly Note[]): NoteFeatures[] {
  if (notes.length === 0) return [];
  const firstOnset = notes[0].startS;
  const totalDuration = notes[notes.length - 1].endS - firstOnset;
  const maxDuration = Math.max(...notes.map((n) => n.durationMs));
  const maxPeakDb = Math.max(...notes.map((n) => n.peakDb));
  return notes.map((n) => {
    const onset = totalDuration > 0 ? (n.startS - firstOnset) / totalDuration : 0;
    const duration = maxDuration > 0 ? n.durationMs / maxDuration : 1;
    const resonance = Number.isFinite(n.resonanceHz) ? n.resonanceHz : RESONANCE_CENTER_HZ;
    return [
      onset,
      duration,
      (n.peakDb - maxPeakDb) / PEAK_DB_SCALE,
      (resonance - RESONANCE_CENTER_HZ) / RESONANCE_SCALE_HZ,
    ];
  });
}

function featureDistance(a: NoteFeatures, b: NoteFeatures): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}

/** Cumulative DTW cost; row and column 0 are the empty-prefix borders. */
function accumulatedCosts(attempt: NoteFeatures[], ref: NoteFeatures[]): number[][] {
  const costs = Array.from({ length: attempt.length + 1 }, () => new Array<number>(ref.length + 1).fill(Infinity));
  costs[0][0] = 0;
  for (let i = 1; i <= attempt.length; i++) {
    for (let j = 1; j <= ref.length; j++) {
      const best = Math.min(costs[i - 1][j - 1], costs[i - 1][j], costs[i][j - 1]);
      costs[i][j] = best + featureDistance(attempt[i - 1], ref[j - 1]);
    }
  }
  return costs;
}

/**
 * Pairs attempt notes with reference notes by dynamic time warping, for the results chart.
 * A diagonal step pairs a note with a note; a step along one list alone leaves that note unmatched (`null` on the other side).
 * Returns index pairs ordered by time.
 */
export function pairNotes(attempt: Note[], ref: Note[]): NotePair[] {
  const a = noteFeatures(attempt);
  const r = noteFeatures(ref);
  const costs = accumulatedCosts(a, r);
  const pairs: NotePair[] = [];
  let i = a.length;
  let j = r.length;
  while (i > 0 && j > 0) {
    const diagonal = costs[i - 1][j - 1];
    const vertical = costs[i - 1][j];
    const horizontal = costs[i][j - 1];
    if (diagonal <= vertical && diagonal <= horizontal) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (vertical <= horizontal) {
      pairs.push([i - 1, null]);
      i--;
    } else {
      pairs.push([null, j - 1]);
      j--;
    }
  }
  // One list is used up; whatever remains of the other has no partner.
  for (; i > 0; i--) pairs.push([i - 1, null]);
  for (; j > 0; j--) pairs.push([null, j - 1]);
  return pairs.reverse();
}
