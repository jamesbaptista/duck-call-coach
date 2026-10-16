import { analyzeInWorker, resetAnalysisWorker } from "../analysis/client";
import type { AnalysisResult, CallType } from "../analysis/types";
import { getDefaultStore, type AttemptRecord } from "../storage/db";
import { forgetUnsavedAttempt, rememberUnsavedAttempt } from "./session";
import { isTimeout, withTimeout } from "./timeout";
import { buildAttempt, buildFailedAttempt, type AttemptRecording, type ScoringReference } from "./attempt";
import { decodeToMono } from "./decode";

/**
 * From recorded samples to a saved attempt. A failed (or too slow) analysis and a failed save come back as
 * values. Only a bug in building the attempt (scoring, tips) rejects, so it shows as an app error instead.
 */

/** An analysis still running after this long is treated as failed, so the user can retry instead of waiting. */
export const ANALYSIS_TIMEOUT_MS = 30_000;

export interface AttemptIdentity {
  id: string;
  createdAt: number;
}

export interface AnalyzedAttempt {
  attempt: AttemptRecord;
  /** Set when the analysis failed; null when it succeeded (even if the call couldn't be judged). */
  failure: { error: unknown } | null;
}

export type SaveOutcome = { saved: true } | { saved: false; error: unknown };

interface ScoringInputs {
  reference: ScoringReference | undefined;
  bestFlatness: number | null;
}

/** The active reference's measurements and the best flatness so far. Unreadable storage means built-in targets. */
async function loadScoringInputs(callType: CallType): Promise<ScoringInputs> {
  try {
    const store = await getDefaultStore();
    const reference = (await store.listReferences(callType)).find((meta) => meta.active);
    const bestFlatness = reference ? null : await store.bestFlatness(callType);
    return { reference, bestFlatness };
  } catch {
    return { reference: undefined, bestFlatness: null };
  }
}

/**
 * Analyses the samples and builds the attempt. `pcm` is transferred to the worker, so it is unusable afterwards.
 * If the analysis fails, the attempt keeps the recording with no scores and a note (see buildFailedAttempt).
 */
export async function analyzeToAttempt(
  pcm: Float32Array,
  sampleRate: number,
  callType: CallType,
  recording: AttemptRecording,
  identity: AttemptIdentity,
): Promise<AnalyzedAttempt> {
  const inputs = loadScoringInputs(callType);
  let analysis: AnalysisResult;
  try {
    analysis = await withTimeout(analyzeInWorker(pcm, sampleRate, callType), ANALYSIS_TIMEOUT_MS);
  } catch (error) {
    if (isTimeout(error)) resetAnalysisWorker("The analysis took too long and was stopped.");
    const { reference } = await inputs;
    return { attempt: buildFailedAttempt({ ...identity, callType, recording, reference, error }), failure: { error } };
  }
  return { attempt: buildAttempt({ ...identity, recording, analysis, ...(await inputs) }), failure: null };
}

/** Analyses a saved attempt's recording again: decodes it, mixes it to mono, and keeps its id and time. */
export async function retryAnalysis(attempt: AttemptRecord): Promise<AnalyzedAttempt> {
  const recording: AttemptRecording = {
    blob: attempt.audio,
    mimeType: attempt.mimeType,
    durationMs: attempt.durationMs,
    processing: { processingOff: attempt.processingOff },
  };
  let decoded: { pcm: Float32Array; sampleRate: number };
  try {
    decoded = await decodeToMono(attempt.audio);
  } catch (error) {
    return { attempt, failure: { error } };
  }
  const identity = { id: attempt.id, createdAt: attempt.createdAt };
  return analyzeToAttempt(decoded.pcm, decoded.sampleRate, attempt.callType, recording, identity);
}

/** Saves the attempt; if that fails, keeps it in memory so the Results screen can still show it. */
export async function saveOrRemember(attempt: AttemptRecord): Promise<SaveOutcome> {
  try {
    await (await getDefaultStore()).saveAttempt(attempt);
    forgetUnsavedAttempt(attempt.id);
    return { saved: true };
  } catch (error) {
    rememberUnsavedAttempt(attempt);
    return { saved: false, error };
  }
}
