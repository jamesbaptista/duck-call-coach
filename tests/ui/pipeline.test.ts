import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../src/analysis/analyze";
import type { AnalysisResult } from "../../src/analysis/types";
import { analyzeInWorker, resetAnalysisWorker } from "../../src/analysis/client";
import { buildAttempt, isAnalysisFailed } from "../../src/ui/attempt";
import { ANALYSIS_TIMEOUT_MS, analyzeToAttempt } from "../../src/ui/pipeline";
import { readWav } from "../helpers/wav";

vi.mock("../../src/analysis/client", () => ({ analyzeInWorker: vi.fn(), resetAnalysisWorker: vi.fn() }));

vi.mock("../../src/storage/db", () => ({
  getDefaultStore: async () => ({
    listReferences: async () => [],
    bestFlatness: async () => null,
  }),
}));

vi.mock("../../src/ui/attempt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ui/attempt")>();
  return { ...actual, buildAttempt: vi.fn(actual.buildAttempt) };
});

const { samples, sampleRate } = readWav("tests/fixtures/hail_a.wav");
const HAIL_A: AnalysisResult = analyze(samples, sampleRate, "hail");

const RECORDING = {
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
  mimeType: "audio/webm",
  durationMs: 2500,
  processing: { processingOff: true },
};
const IDENTITY = { id: "attempt-1", createdAt: 1_700_000_000_000 };

function run(): ReturnType<typeof analyzeToAttempt> {
  return analyzeToAttempt(new Float32Array(16), 48_000, "hail", RECORDING, IDENTITY);
}

describe("analyzeToAttempt", () => {
  beforeEach(() => {
    vi.mocked(analyzeInWorker).mockReset();
    vi.mocked(resetAnalysisWorker).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a scored attempt from a finished analysis", async () => {
    vi.mocked(analyzeInWorker).mockResolvedValue(HAIL_A);
    const { attempt, failure } = await run();
    expect(failure).toBeNull();
    expect(attempt).toMatchObject({ id: "attempt-1", createdAt: IDENTITY.createdAt, callType: "hail" });
    expect(attempt.scores).not.toBeNull();
  });

  it("keeps the recording as a failed attempt when the analysis rejects", async () => {
    const error = new Error("The analysis worker crashed");
    vi.mocked(analyzeInWorker).mockRejectedValue(error);
    const { attempt, failure } = await run();
    expect(failure).toEqual({ error });
    expect(isAnalysisFailed(attempt)).toBe(true);
    expect(attempt.audio).toBe(RECORDING.blob);
    expect(resetAnalysisWorker).not.toHaveBeenCalled();
  });

  it("gives up on an analysis that hasn't finished after 30 s", async () => {
    vi.useFakeTimers();
    vi.mocked(analyzeInWorker).mockReturnValue(new Promise<AnalysisResult>(() => undefined));
    const settled = vi.fn();
    const result = run();
    result.then(settled, settled);

    expect(ANALYSIS_TIMEOUT_MS).toBe(30_000);
    await vi.advanceTimersByTimeAsync(ANALYSIS_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const { attempt, failure } = await result;
    expect(failure?.error).toMatchObject({ name: "TimeoutError" });
    expect(isAnalysisFailed(attempt)).toBe(true);
    expect(attempt.id).toBe("attempt-1");
    // The stuck worker is thrown away, so Retry analysis gets a fresh one.
    expect(resetAnalysisWorker).toHaveBeenCalledTimes(1);
  });

  it("lets a scoring or tips bug surface as an error instead of a failed analysis", async () => {
    vi.mocked(analyzeInWorker).mockResolvedValue(HAIL_A);
    const bug = new Error("selectTips blew up");
    vi.mocked(buildAttempt).mockImplementationOnce(() => {
      throw bug;
    });
    await expect(run()).rejects.toBe(bug);
  });
});
