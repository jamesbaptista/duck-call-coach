import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/analyze";
import type { AnalysisResult, CallMeasurements } from "../../src/analysis/types";
import type { ProcessingReport } from "../../src/capture/recorder";
import { ANALYZER_VERSION } from "../../src/config/analysis";
import { targetsFromReference, withFlatnessBaseline } from "../../src/scoring/reference";
import { loadTargets, scoreAttempt } from "../../src/scoring/score";
import { selectTips } from "../../src/scoring/tips";
import { exportBackup, parseBackup } from "../../src/storage/backup";
import { MAX_TIP_LENGTH } from "../../src/storage/backupSchema";
import { createStore, openDb, type AttemptRecord } from "../../src/storage/db";
import { buildAttempt, buildFailedAttempt, isAnalysisFailed } from "../../src/ui/attempt";
import { readWav } from "../helpers/wav";

const { samples, sampleRate } = readWav("tests/fixtures/hail_a.wav");
const HAIL_A: AnalysisResult = analyze(samples, sampleRate, "hail");

const PROCESSING_OFF: ProcessingReport = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  processingOff: true,
};

const RECORDING = {
  blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }),
  mimeType: "audio/webm",
  durationMs: 2500,
  processing: PROCESSING_OFF,
};

function measured(analysis: AnalysisResult): CallMeasurements {
  if (analysis.measurements === null) throw new Error("expected measurements");
  return analysis.measurements;
}

function build(over: Partial<Parameters<typeof buildAttempt>[0]> = {}): AttemptRecord {
  return buildAttempt({
    id: "attempt-1",
    createdAt: 1_700_000_000_000,
    recording: RECORDING,
    analysis: HAIL_A,
    reference: undefined,
    bestFlatness: null,
    ...over,
  });
}

describe("buildAttempt", () => {
  it("uses hail_a as a realistic, judged analysis", () => {
    expect(HAIL_A.quality).toBeNull();
    expect(HAIL_A.measurements).not.toBeNull();
  });

  it("scores against the built-in targets when there is no reference", () => {
    const attempt = build();
    const expected = scoreAttempt(measured(HAIL_A), loadTargets("hail"));
    expect(attempt.targetSource).toBe("builtin");
    expect(attempt.scores).toEqual(expected);
    expect(attempt.tips.problems).toEqual(selectTips("hail", expected).problems);
    expect(attempt.scores?.measures.some((m) => m.key === "flatness")).toBe(false);
  });

  it("copies the recording and analysis into the record", () => {
    const attempt = build({ recording: { ...RECORDING, processing: { ...PROCESSING_OFF, processingOff: false } } });
    expect(attempt).toMatchObject({
      id: "attempt-1",
      callType: "hail",
      createdAt: 1_700_000_000_000,
      analyzerVersion: ANALYZER_VERSION,
      analysis: HAIL_A,
      audio: RECORDING.blob,
      mimeType: "audio/webm",
      durationMs: 2500,
      processingOff: false,
    });
  });

  it("adds a rasp target around the best flatness so far", () => {
    const attempt = build({ bestFlatness: 0.2 });
    const flatness = attempt.scores?.measures.find((m) => m.key === "flatness");
    expect(flatness?.lo).toBeCloseTo(0.12);
    expect(flatness?.hi).toBeCloseTo(0.28);
    expect(attempt.scores).toEqual(scoreAttempt(measured(HAIL_A), withFlatnessBaseline(loadTargets("hail"), 0.2)));
  });

  it("scores against the active reference and its own flatness, ignoring the best flatness", () => {
    const refMeasurements: CallMeasurements = { ...measured(HAIL_A), spacingMs: 500, flatness: 0.4 };
    const attempt = build({ reference: { measurements: refMeasurements }, bestFlatness: 0.05 });
    const targets = withFlatnessBaseline(targetsFromReference(loadTargets("hail"), refMeasurements), 0.4);
    expect(attempt.targetSource).toBe("reference");
    expect(attempt.scores).toEqual(scoreAttempt(measured(HAIL_A), targets));
    const spacing = attempt.scores?.measures.find((m) => m.key === "spacingMs");
    expect(spacing?.lo).toBeCloseTo(425);
    expect(spacing?.hi).toBeCloseTo(575);
  });

  it("does not change the cached built-in targets", () => {
    const before = structuredClone(loadTargets("hail"));
    build({ reference: { measurements: { ...measured(HAIL_A), flatness: 0.4 } }, bestFlatness: 0.2 });
    expect(loadTargets("hail")).toEqual(before);
  });

  it("leaves an attempt with a quality issue unscored, with no tips", () => {
    const tooQuiet: AnalysisResult = { ...HAIL_A, quality: "too_quiet" };
    const attempt = build({ analysis: tooQuiet, bestFlatness: 0.2 });
    expect(attempt.scores).toBeNull();
    expect(attempt.tips).toEqual({ problems: [], positive: null });
    expect(attempt.analysis.quality).toBe("too_quiet");
    expect(isAnalysisFailed(attempt)).toBe(false);
  });
});

describe("buildFailedAttempt", () => {
  it("keeps the recording, with no scores and a note saying the analysis failed", () => {
    const attempt = buildFailedAttempt({
      id: "attempt-2",
      createdAt: 1_700_000_000_000,
      callType: "chuckle",
      recording: RECORDING,
      reference: undefined,
      error: new Error("The analysis worker crashed"),
    });
    expect(attempt.callType).toBe("chuckle");
    expect(attempt.audio).toBe(RECORDING.blob);
    expect(attempt.scores).toBeNull();
    expect(attempt.analysis).toMatchObject({ callType: "chuckle", quality: null, measurements: null, notes: [] });
    expect(attempt.analysis.analyzerVersion).toBe(ANALYZER_VERSION);
    expect(attempt.tips.problems).toHaveLength(1);
    expect(attempt.tips.problems[0]).toContain("The analysis worker crashed");
    expect(attempt.tips.problems[0]).toContain("Retry analysis");
    expect(isAnalysisFailed(attempt)).toBe(true);
  });

  it("keeps the note short enough for a backup to restore", () => {
    const attempt = buildFailedAttempt({
      id: "attempt-3",
      createdAt: 1,
      callType: "hail",
      recording: RECORDING,
      reference: { measurements: measured(HAIL_A) },
      error: new Error("x".repeat(5000)),
    });
    expect(attempt.targetSource).toBe("reference");
    expect(attempt.tips.problems[0].length).toBeLessThanOrEqual(MAX_TIP_LENGTH);
  });
});

describe("built attempts in a backup", () => {
  it("survive save, back up and restore validation unchanged", async () => {
    const store = createStore(await openDb("attempt-test-db"));
    const scored = build({ id: "scored", bestFlatness: 0.2 });
    const failed = buildFailedAttempt({
      id: "failed",
      createdAt: 2,
      callType: "hail",
      recording: RECORDING,
      reference: undefined,
      error: "worker gone",
    });
    await store.saveAttempt(scored);
    await store.saveAttempt(failed);
    const restored = parseBackup(await (await exportBackup(store)).text());
    const byId = new Map(restored.attempts.map((a) => [a.id, a]));
    const { audio: _scoredAudio, ...scoredMeta } = scored;
    const { audio: _failedAudio, ...failedMeta } = failed;
    expect(byId.get("scored")).toMatchObject(scoredMeta);
    expect(byId.get("failed")).toMatchObject(failedMeta);
    store.close();
  });
});
