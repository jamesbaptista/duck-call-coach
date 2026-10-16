import { describe, expect, it } from "vitest";
import type { RecordingPhase } from "../../src/ui/recordingControl";
import { BACKGROUND_STOP_TEXT, discardsWhenHidden } from "../../src/ui/recordingInterruption";

const PHASES: RecordingPhase[] = ["idle", "starting", "recording", "finishing", "processing"];

describe("discardsWhenHidden", () => {
  it("throws the recording away when the app goes to the background mid-recording", () => {
    expect(discardsWhenHidden("recording", "hidden")).toBe(true);
  });

  it("does nothing when the page becomes visible again", () => {
    for (const phase of PHASES) expect(discardsWhenHidden(phase, "visible")).toBe(false);
  });

  it("leaves every other phase alone, so a recording already stopping still gets analyzed", () => {
    for (const phase of PHASES.filter((p) => p !== "recording")) expect(discardsWhenHidden(phase, "hidden")).toBe(false);
  });
});

describe("BACKGROUND_STOP_TEXT", () => {
  it("says why the recording stopped and what to do", () => {
    expect(BACKGROUND_STOP_TEXT).toBe("Recording stopped because the app went to the background. Try again.");
  });
});
