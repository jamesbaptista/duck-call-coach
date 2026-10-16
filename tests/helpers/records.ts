import type { AnalysisResult, CallMeasurements, CallType } from "../../src/analysis/types";
import type { Scores } from "../../src/scoring/types";
import type { AttemptRecord, ReferenceRecord } from "../../src/storage/db";

export const MEASUREMENTS: CallMeasurements = {
  noteCount: 5,
  spacingMs: 250,
  spacingCv: 0.1,
  burstSpacingMs: null,
  firstNoteMs: 120,
  lastNoteMs: 100,
  medianNoteMs: 110,
  lastFirstRatio: 0.8,
  loudestIndex: 1,
  fadeDb: -6,
  resonanceHz: 1500,
  resonanceSlopeHzPerNote: -20,
  flatness: 0.3,
  maxSqueakShare: 0.05,
  longNoteCount: 0,
  snrDb: 30,
};

export function scoresOf(overall: number): Scores {
  return { overall, subs: { rhythm: overall, notes: overall, pitch: overall, tone: overall }, measures: [] };
}

export function analysisOf(callType: CallType, flatness: number | null): AnalysisResult {
  return {
    callType,
    analyzerVersion: "1.0.0",
    noiseFloorDb: -60,
    notes: [],
    measurements: flatness === null ? null : { ...MEASUREMENTS, flatness },
    quality: null,
  };
}

export function attempt(id: string, callType: CallType, createdAt: number, over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id,
    callType,
    createdAt,
    analyzerVersion: "1.0.0",
    analysis: analysisOf(callType, 0.3),
    scores: scoresOf(50),
    tips: { problems: ["Slow down."], positive: null },
    audio: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }),
    mimeType: "audio/webm",
    durationMs: 2000,
    processingOff: true,
    targetSource: "builtin",
    ...over,
  };
}

export function reference(id: string, callType: CallType, createdAt: number, active = false): ReferenceRecord {
  return {
    id,
    callType,
    name: `Reference ${id}`,
    createdAt,
    audio: new Blob([new Uint8Array([9, 8, 7])], { type: "audio/mp4" }),
    mimeType: "audio/mp4",
    measurements: MEASUREMENTS,
    notes: [
      {
        startS: 0.1,
        endS: 0.2,
        durationMs: 100,
        peakDb: -20,
        resonanceHz: 1500,
        fundamentalHz: null,
        squeakShare: null,
        flatness: 0.3,
      },
    ],
    active,
  };
}

export async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}
