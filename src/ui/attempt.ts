import type { AnalysisResult, CallMeasurements, CallType } from "../analysis/types";
import type { RecordingResult } from "../capture/recorder";
import { ANALYZER_VERSION } from "../config/analysis";
import { targetsFromReference, withFlatnessBaseline } from "../scoring/reference";
import { loadTargets, scoreAttempt } from "../scoring/score";
import { selectTips } from "../scoring/tips";
import type { CallTargets } from "../scoring/types";
import type { AttemptRecord } from "../storage/db";

/**
 * Turning a recording and its analysis into the attempt that gets saved. Pure: no storage and no browser APIs,
 * so the screens gather the inputs and these functions only assemble them. Shared by Practice, Results and History.
 */

/** The parts of a recording an attempt keeps. A RecordingResult fits, and so does one rebuilt from a saved attempt. */
export interface AttemptRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  processing: Pick<RecordingResult["processing"], "processingOff">;
}

/** The active reference: its measurements score the attempt and its id is saved with it. A ReferenceMeta fits. */
export interface ScoringReference {
  id: string;
  measurements: CallMeasurements;
}

export interface BuildAttemptInput {
  id: string;
  createdAt: number;
  recording: AttemptRecording;
  analysis: AnalysisResult;
  /** The active reference for this call type, if any. */
  reference: ScoringReference | undefined;
  /** The flattest (rasp) value among the user's past attempts, used when there is no reference. */
  bestFlatness: number | null;
}

export interface BuildFailedAttemptInput {
  id: string;
  createdAt: number;
  callType: CallType;
  recording: AttemptRecording;
  reference: ScoringReference | undefined;
  error: unknown;
}

/** Keeps the saved note well under the backup's 500-character limit for a tip. */
const MAX_ERROR_DETAIL_CHARS = 200;

/** The targets an attempt is judged against: the active reference's, else the built-in ones, plus a rasp baseline. */
export function chooseTargets(
  callType: CallType,
  reference: Pick<ScoringReference, "measurements"> | undefined,
  bestFlatness: number | null,
): CallTargets {
  const builtIn = loadTargets(callType);
  const base = reference ? targetsFromReference(builtIn, reference.measurements) : builtIn;
  return withFlatnessBaseline(base, reference ? reference.measurements.flatness : bestFlatness);
}

function recordingFields(recording: AttemptRecording): Pick<AttemptRecord, "audio" | "mimeType" | "durationMs" | "processingOff"> {
  return {
    audio: recording.blob,
    mimeType: recording.mimeType,
    durationMs: recording.durationMs,
    processingOff: recording.processing.processingOff,
  };
}

function judge(analysis: AnalysisResult, targets: CallTargets): Pick<AttemptRecord, "scores" | "tips"> {
  if (analysis.quality !== null || analysis.measurements === null) {
    return { scores: null, tips: { problems: [], positive: null } };
  }
  const scores = scoreAttempt(analysis.measurements, targets);
  const { problems, positive } = selectTips(analysis.callType, scores);
  return { scores, tips: { problems, positive: positive === "" ? null : positive } };
}

/** The attempt record for a recording that was analysed. An attempt with a quality issue is saved unscored. */
export function buildAttempt(input: BuildAttemptInput): AttemptRecord {
  const { analysis, reference } = input;
  const targets = chooseTargets(analysis.callType, reference, input.bestFlatness);
  return {
    id: input.id,
    callType: analysis.callType,
    createdAt: input.createdAt,
    analyzerVersion: analysis.analyzerVersion,
    analysis,
    ...judge(analysis, targets),
    ...recordingFields(input.recording),
    targetSource: reference ? "reference" : "builtin",
    ...(reference ? { referenceId: reference.id } : {}),
  };
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  const detail = text.trim() || "unknown error";
  return detail.length > MAX_ERROR_DETAIL_CHARS ? `${detail.slice(0, MAX_ERROR_DETAIL_CHARS - 1)}…` : detail;
}

/**
 * The attempt saved when the analysis itself failed: the recording is kept so it can be analysed again.
 * It has no notes, no measurements, no quality issue and no scores; the note explaining why is its only tip.
 * (`noiseFloorDb` is 0 only because the field must hold a finite number; nothing reads it without measurements.)
 */
export function buildFailedAttempt(input: BuildFailedAttemptInput): AttemptRecord {
  return {
    id: input.id,
    callType: input.callType,
    createdAt: input.createdAt,
    analyzerVersion: ANALYZER_VERSION,
    analysis: {
      callType: input.callType,
      analyzerVersion: ANALYZER_VERSION,
      noiseFloorDb: 0,
      notes: [],
      measurements: null,
      quality: null,
    },
    scores: null,
    tips: {
      problems: [
        `The analysis didn't finish (${errorDetail(input.error)}). Your recording is saved: tap Retry analysis to try again.`,
      ],
      positive: null,
    },
    ...recordingFields(input.recording),
    targetSource: input.reference ? "reference" : "builtin",
  };
}

/** True for an attempt whose analysis failed (as opposed to one judged unscoreable, which has a quality issue). */
export function isAnalysisFailed(attempt: Pick<AttemptRecord, "analysis" | "scores">): boolean {
  return attempt.scores === null && attempt.analysis.quality === null && attempt.analysis.measurements === null;
}
