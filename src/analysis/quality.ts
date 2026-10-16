import { ANALYSIS } from "../config/analysis";
import { snrDb } from "./measure";
import type { CallType, Note, QualityIssue } from "./types";

/** Share of samples at or beyond clipLevel in either direction; 0 for empty input. */
export function clippedFraction(raw: Float32Array): number {
  if (raw.length === 0) return 0;
  let clipped = 0;
  for (let i = 0; i < raw.length; i++) if (Math.abs(raw[i]) >= ANALYSIS.clipLevel) clipped++;
  return clipped / raw.length;
}

/**
 * Why a recording cannot be scored, checked in this order: clipping of the raw input, no notes, too quiet
 * above the noise floor, then too few notes for a multi-note call. Null when it can be scored.
 */
export function qualityIssue(raw: Float32Array, scored: Note[], callType: CallType, floorDb: number): QualityIssue | null {
  if (clippedFraction(raw) > ANALYSIS.clipFraction) return "clipped";
  if (scored.length === 0) return "no_notes";
  if (snrDb(scored, floorDb) < ANALYSIS.minSnrDb) return "too_quiet";
  if (callType !== "quack" && scored.length < ANALYSIS.minCallNotes) return "too_few_notes";
  return null;
}
