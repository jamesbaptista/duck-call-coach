import { ANALYSIS } from "../config/analysis";
import type { NoteSpan } from "./types";

const SMOOTH_FRAMES = 3;
/** Absorbs floating-point error when comparing frame counts against durations in seconds. */
const DURATION_EPSILON = 1e-9;

/** Frames-to-seconds comparisons: true when `frames` is strictly shorter than `limitS`. */
function isShorter(frames: number, limitS: number): boolean {
  return frames * ANALYSIS.hopS < limitS - DURATION_EPSILON;
}

/** True when `frames` is no longer than `limitS`. */
function isAtMost(frames: number, limitS: number): boolean {
  return frames * ANALYSIS.hopS <= limitS + DURATION_EPSILON;
}

/** Noise floor: the 10th percentile of the frame levels, linearly interpolated (like numpy). */
export function noiseFloorDb(levels: Float32Array): number {
  if (levels.length === 0) return -Infinity;
  const sorted = Float32Array.from(levels).sort();
  const position = ((sorted.length - 1) * ANALYSIS.floorPercentile) / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function peakOf(levels: Float32Array, from: number, to: number): number {
  let peak = -Infinity;
  for (let i = from; i < to; i++) peak = Math.max(peak, levels[i]);
  return peak;
}

/** Step 1: loud regions, entered at floor + onDb and left below floor + offDb. */
function hysteresisRegions(levels: Float32Array, floorDb: number): NoteSpan[] {
  const onDb = floorDb + ANALYSIS.onDb;
  const offDb = floorDb + ANALYSIS.offDb;
  const regions: NoteSpan[] = [];
  let start = -1;
  for (let i = 0; i < levels.length; i++) {
    if (start < 0 && levels[i] >= onDb) {
      start = i;
    } else if (start >= 0 && levels[i] < offDb) {
      regions.push({ startFrame: start, endFrame: i });
      start = -1;
    }
  }
  if (start >= 0) regions.push({ startFrame: start, endFrame: levels.length });
  return regions;
}

/** Step 2: join neighbouring spans separated by a gap shorter than mergeGapS. */
function mergeShortGaps(spans: NoteSpan[]): NoteSpan[] {
  const merged: NoteSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && isShorter(span.startFrame - previous.endFrame, ANALYSIS.mergeGapS)) {
      previous.endFrame = span.endFrame;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** Centered 3-frame moving average, zero-padded at the array ends (numpy `convolve(..., "same")`). */
function smoothLevels(levels: Float32Array): Float32Array {
  const smoothed = new Float32Array(levels.length);
  for (let i = 0; i < levels.length; i++) {
    const before = i > 0 ? levels[i - 1] : 0;
    const after = i < levels.length - 1 ? levels[i + 1] : 0;
    smoothed[i] = (before + levels[i] + after) / SMOOTH_FRAMES;
  }
  return smoothed;
}

function isLocalMinimum(smoothed: Float32Array, i: number): boolean {
  return smoothed[i] <= smoothed[i - 1] && smoothed[i] <= smoothed[i + 1];
}

/** True when the smoothed level at `i` is a dip: a deep-enough drop from the run behind and a recovery ahead. */
function isDipCut(smoothed: Float32Array, lastCut: number, i: number, end: number): boolean {
  const lookahead = Math.round(ANALYSIS.dipLookaheadS / ANALYSIS.hopS);
  const dropFromBehind = peakOf(smoothed, lastCut, i + 1) - smoothed[i];
  const riseAhead = peakOf(smoothed, i, Math.min(i + lookahead + 1, end)) - smoothed[i];
  return (
    dropFromBehind >= ANALYSIS.dipDb &&
    riseAhead >= ANALYSIS.dipDb &&
    !isShorter(i - lastCut, ANALYSIS.minNoteS)
  );
}

/** Step 3: split one loud region at its dips. */
function splitRegionAtDips(smoothed: Float32Array, region: NoteSpan): NoteSpan[] {
  const spans: NoteSpan[] = [];
  let lastCut = region.startFrame;
  for (let i = region.startFrame + 1; i < region.endFrame - 1; i++) {
    if (isLocalMinimum(smoothed, i) && isDipCut(smoothed, lastCut, i, region.endFrame)) {
      spans.push({ startFrame: lastCut, endFrame: i });
      lastCut = i;
    }
  }
  spans.push({ startFrame: lastCut, endFrame: region.endFrame });
  return spans;
}

function splitAtDips(levels: Float32Array, regions: NoteSpan[]): NoteSpan[] {
  const smoothed = smoothLevels(levels);
  return regions.flatMap((region) => splitRegionAtDips(smoothed, region));
}

/** Step 4: remove spans shorter than minNoteS. */
function dropShortNotes(spans: NoteSpan[]): NoteSpan[] {
  return spans.filter((span) => !isShorter(span.endFrame - span.startFrame, ANALYSIS.minNoteS));
}

function isEchoTail(levels: Float32Array, previous: NoteSpan, blip: NoteSpan): boolean {
  const blipFrames = blip.endFrame - blip.startFrame;
  const gapFrames = blip.startFrame - previous.endFrame;
  const quieterBy =
    peakOf(levels, previous.startFrame, previous.endFrame) -
    peakOf(levels, blip.startFrame, blip.endFrame);
  return (
    isAtMost(blipFrames, ANALYSIS.tailMaxS) &&
    isShorter(gapFrames, ANALYSIS.tailGapS) &&
    quieterBy >= ANALYSIS.tailDropDb
  );
}

/** Step 5: fold short, much quieter echo blips into the note before them. */
function mergeEchoTails(levels: Float32Array, spans: NoteSpan[]): NoteSpan[] {
  const merged: NoteSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && isEchoTail(levels, previous, span)) {
      previous.endFrame = span.endFrame;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** Step 6: pull each edge in past frames more than edgeDb below the note's own peak. */
function trimEdges(levels: Float32Array, span: NoteSpan): NoteSpan {
  const cutoff = peakOf(levels, span.startFrame, span.endFrame) - ANALYSIS.edgeDb;
  let { startFrame, endFrame } = span;
  while (startFrame < endFrame - 1 && levels[startFrame] < cutoff) startFrame++;
  while (endFrame - 1 > startFrame && levels[endFrame - 1] < cutoff) endFrame--;
  return { startFrame, endFrame };
}

/** Turns per-frame levels into note spans (end exclusive). */
export function findNotes(levels: Float32Array, floorDb: number): NoteSpan[] {
  const merged = mergeShortGaps(hysteresisRegions(levels, floorDb));
  const notes = dropShortNotes(splitAtDips(levels, merged));
  return mergeEchoTails(levels, notes).map((span) => trimEdges(levels, span));
}
