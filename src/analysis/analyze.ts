import { ANALYSIS, ANALYZER_VERSION } from "../config/analysis";
import { highPass } from "./filter";
import { SILENT_FRAME_DB, frameLevelsDb, spanSampleRange } from "./frames";
import { buildSequences, measureCall, pickScored } from "./measure";
import { flatness, spectralPeaks, squeakShare } from "./noteFeatures";
import { findNotes, noiseFloorDb, peakOf } from "./notes";
import { qualityIssue } from "./quality";
import type { AnalysisResult, CallType, Note, NoteSpan } from "./types";

const MS_PER_S = 1000;

/**
 * The noise floor as reported. A recording shorter than one frame has no levels and so no floor
 * (-Infinity); it is reported as the level of digital silence so the result stays finite.
 */
function reportableFloorDb(levels: Float32Array): number {
  const floorDb = noiseFloorDb(levels);
  return Number.isFinite(floorDb) ? floorDb : SILENT_FRAME_DB;
}

/** Per-note features of one span. Squeak is skipped for notes more than squeakSkipBelowDb below the loudest. */
function measureNote(x: Float32Array, sampleRate: number, span: NoteSpan, peakDb: number, loudestDb: number): Note {
  const [s0, s1] = spanSampleRange(span, sampleRate, x.length);
  const { resonanceHz, fundamentalHz } = spectralPeaks(x, sampleRate, s0, s1);
  const loudEnough = loudestDb - peakDb <= ANALYSIS.squeakSkipBelowDb;
  return {
    startS: span.startFrame * ANALYSIS.hopS,
    endS: span.endFrame * ANALYSIS.hopS,
    durationMs: (span.endFrame - span.startFrame) * ANALYSIS.hopS * MS_PER_S,
    peakDb,
    resonanceHz,
    fundamentalHz,
    squeakShare: loudEnough ? squeakShare(x, sampleRate, s0, s1) : null,
    flatness: flatness(x, sampleRate, s0, s1),
  };
}

/** Measures every span; squeak is judged against the loudest note in the whole recording. */
function measureNotes(x: Float32Array, sampleRate: number, levels: Float32Array, spans: NoteSpan[]): Note[] {
  const peaksDb = spans.map((span) => peakOf(levels, span.startFrame, span.endFrame));
  const loudestDb = peaksDb.reduce((loudest, peak) => Math.max(loudest, peak), -Infinity);
  return spans.map((span, i) => measureNote(x, sampleRate, span, peaksDb[i], loudestDb));
}

/** Full analysis of one raw mono recording: the scored notes, the quality verdict and, if it passes, the measurements. */
export function analyze(raw: Float32Array, sampleRate: number, callType: CallType): AnalysisResult {
  const x = highPass(raw, sampleRate);
  const levels = frameLevelsDb(x, sampleRate);
  const floorDb = reportableFloorDb(levels);
  const notes = measureNotes(x, sampleRate, levels, findNotes(levels, floorDb));
  const scored = pickScored(buildSequences(notes), callType);
  const quality = qualityIssue(raw, scored, callType, floorDb);
  return {
    callType,
    analyzerVersion: ANALYZER_VERSION,
    noiseFloorDb: floorDb,
    notes: scored,
    measurements: quality ? null : measureCall(scored, floorDb),
    quality,
  };
}
