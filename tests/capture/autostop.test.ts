import { describe, expect, it } from "vitest";
import { AutoStop } from "../../src/capture/autostop";

const STEP_S = 0.01;
const QUIET_DB = -60;
const LOUD_DB = -20;

/** Feed `durationS` of constant level starting at `startS`; returns the first time update() was true. */
function feed(stop: AutoStop, level: number, startS: number, durationS: number): number | null {
  const steps = Math.round(durationS / STEP_S);
  for (let i = 0; i < steps; i++) {
    const t = startS + i * STEP_S;
    if (stop.update(level, t)) return t;
  }
  return null;
}

describe("AutoStop", () => {
  it("stops 1.5 s after the last note, not before", () => {
    const stop = new AutoStop();
    expect(feed(stop, QUIET_DB, 0, 0.5)).toBeNull();
    expect(feed(stop, LOUD_DB, 0.5, 0.3)).toBeNull();
    const loudEnds = 0.8;
    const stoppedAt = feed(stop, QUIET_DB, loudEnds, 3);
    expect(stoppedAt).not.toBeNull();
    expect(stoppedAt!).toBeGreaterThanOrEqual(loudEnds + 1.5 - 1e-9);
    expect(stoppedAt!).toBeLessThan(loudEnds + 1.5 + 0.05);
  });

  it("does not stop on silence alone before the hard limit", () => {
    const stop = new AutoStop();
    expect(feed(stop, QUIET_DB, 0, 14.99)).toBeNull();
    expect(stop.update(QUIET_DB, 15)).toBe(true);
  });

  it("stops at the hard limit even if a note was just heard", () => {
    const stop = new AutoStop();
    expect(feed(stop, QUIET_DB, 0, 14.9)).toBeNull();
    expect(stop.update(LOUD_DB, 14.9)).toBe(false);
    expect(stop.update(LOUD_DB, 14.95)).toBe(false);
    expect(stop.update(LOUD_DB, 15)).toBe(true);
  });

  it("restarts the silence timer when another note arrives", () => {
    const stop = new AutoStop();
    feed(stop, QUIET_DB, 0, 0.5);
    feed(stop, LOUD_DB, 0.5, 0.3);
    expect(feed(stop, QUIET_DB, 0.8, 1.0)).toBeNull();
    expect(feed(stop, LOUD_DB, 1.8, 0.3)).toBeNull();
    const stoppedAt = feed(stop, QUIET_DB, 2.1, 3);
    expect(stoppedAt!).toBeGreaterThanOrEqual(2.1 + 1.5 - 1e-9);
  });

  it("honours custom options", () => {
    const stop = new AutoStop({ silenceS: 0.5, maxS: 2, riseDb: 6 });
    feed(stop, QUIET_DB, 0, 0.5);
    feed(stop, -50, 0.5, 0.2);
    const stoppedAt = feed(stop, QUIET_DB, 0.7, 1);
    expect(stoppedAt!).toBeGreaterThanOrEqual(0.7 + 0.5 - 1e-9);
    expect(stoppedAt!).toBeLessThan(1.3);
  });
});
