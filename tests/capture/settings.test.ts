import { describe, expect, it } from "vitest";
import { toProcessingReport } from "../../src/capture/recorder";

describe("toProcessingReport", () => {
  it("reports processing off when all three settings are false", () => {
    expect(
      toProcessingReport({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }),
    ).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      processingOff: true,
    });
  });

  it("reports processing on when any setting is true", () => {
    const report = toProcessingReport({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(report.echoCancellation).toBe(true);
    expect(report.processingOff).toBe(false);
  });

  it("treats a string mode such as \"all\" as processing on", () => {
    const report = toProcessingReport({
      echoCancellation: "all",
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(report.echoCancellation).toBe(true);
    expect(report.processingOff).toBe(false);
  });

  it("maps missing keys to null and is not off", () => {
    expect(toProcessingReport({})).toEqual({
      echoCancellation: null,
      noiseSuppression: null,
      autoGainControl: null,
      processingOff: false,
    });
  });

  it("is not off when only some keys are present", () => {
    expect(toProcessingReport({ echoCancellation: false }).processingOff).toBe(false);
  });
});
