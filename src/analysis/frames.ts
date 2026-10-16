import { ANALYSIS } from "../config/analysis";
import type { NoteSpan } from "./types";

const RMS_EPSILON = 1e-9;

/** Level of a frame of digital silence: the RMS guard keeps it at -180 dB instead of -Infinity. */
export const SILENT_FRAME_DB = 20 * Math.log10(RMS_EPSILON);

/** Samples in one analysis frame at this sample rate. */
export function frameSamples(sampleRate: number): number {
  return Math.round(ANALYSIS.frameS * sampleRate);
}

/** Samples between the starts of neighbouring frames at this sample rate. */
export function hopSamples(sampleRate: number): number {
  return Math.round(ANALYSIS.hopS * sampleRate);
}

/**
 * Sample range [s0, s1) measured for a span, as in the research script: from the start of its first frame
 * to one frame length past the start of its (exclusive) end frame, clamped to the signal.
 */
export function spanSampleRange(span: NoteSpan, sampleRate: number, length: number): [number, number] {
  const hop = hopSamples(sampleRate);
  return [span.startFrame * hop, Math.min(length, span.endFrame * hop + frameSamples(sampleRate))];
}

/** RMS level in dB for each analysis frame (40 ms frames, 10 ms hop). */
export function frameLevelsDb(x: Float32Array, sampleRate: number): Float32Array {
  const frame = frameSamples(sampleRate);
  const hop = hopSamples(sampleRate);
  const count = x.length < frame ? 0 : Math.floor((x.length - frame) / hop) + 1;
  const levels = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    let sumSquares = 0;
    for (let i = start; i < start + frame; i++) sumSquares += x[i] * x[i];
    levels[f] = 20 * Math.log10(Math.sqrt(sumSquares / frame) + RMS_EPSILON);
  }
  return levels;
}
