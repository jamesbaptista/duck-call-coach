import { describe, expect, it } from "vitest";
import type { Note } from "../../src/analysis/types";
import { notesChartGeometry, type Rect } from "../../src/ui/charts/notesChart";
import type { ShapeNote } from "../../src/ui/charts/targetShape";

const WIDTH = 600;
const HEIGHT = 200;

function note(startS: number, durationMs: number, peakDb: number, resonanceHz = 1900): Note {
  return {
    startS,
    endS: startS + durationMs / 1000,
    durationMs,
    peakDb,
    resonanceHz,
    fundamentalHz: null,
    squeakShare: 0.1,
    flatness: 0.05,
  };
}

/** Five notes starting at 1.2 s, 300 ms apart; the second is the loudest; the last is 60 dB down. */
const ATTEMPT: Note[] = [
  note(1.2, 200, -14),
  note(1.5, 200, -10),
  note(1.8, 150, -20),
  note(2.1, 150, -30),
  note(2.4, 100, -70),
];

/** Three target notes starting at 0 s, ending at 0.9 s. */
const TARGET: ShapeNote[] = [
  { startS: 0, durationMs: 250, levelDb: 0 },
  { startS: 0.3, durationMs: 200, levelDb: 0 },
  { startS: 0.6, durationMs: 300, levelDb: -8 },
];

function allRects(geometry: { attempt: Rect[]; target: Rect[] }): Rect[] {
  return [...geometry.attempt, ...geometry.target];
}

describe("notesChartGeometry", () => {
  const geometry = notesChartGeometry(ATTEMPT, TARGET, WIDTH, HEIGHT);

  it("gives one rect per note in each series", () => {
    expect(geometry.attempt).toHaveLength(5);
    expect(geometry.target).toHaveLength(3);
  });

  it("starts both series at x = 0, at their own first onset", () => {
    expect(geometry.attempt[0].x).toBe(0);
    expect(geometry.target[0].x).toBe(0);
  });

  it("maps the loudest note of each series to the full height", () => {
    expect(geometry.attempt[1]).toMatchObject({ y: 0, h: HEIGHT });
    expect(geometry.target[0]).toMatchObject({ y: 0, h: HEIGHT });
    expect(geometry.target[1]).toMatchObject({ y: 0, h: HEIGHT });
  });

  it("draws height as the level above 40 dB below the loudest note", () => {
    // -20 dB is 10 dB below the loudest (-10), so 30 of 40 dB: three quarters of the height.
    expect(geometry.attempt[2].h).toBeCloseTo(HEIGHT * 0.75);
    expect(geometry.attempt[2].y + geometry.attempt[2].h).toBeCloseTo(HEIGHT);
    expect(geometry.target[2].h).toBeCloseTo(HEIGHT * (32 / 40));
  });

  it("shares one time axis that fits the longer series", () => {
    // The attempt spans 1.2 s to 2.5 s (1.3 s); the target only 0.9 s.
    const pxPerS = WIDTH / 1.3;
    expect(geometry.attempt[4].x + geometry.attempt[4].w).toBeCloseTo(WIDTH);
    expect(geometry.attempt[1].x).toBeCloseTo(0.3 * pxPerS);
    expect(geometry.target[2].x).toBeCloseTo(0.6 * pxPerS);
    expect(geometry.target[2].w).toBeCloseTo(0.3 * pxPerS);
  });

  it("never gives a rect a negative size, even for a note far below the loudest", () => {
    for (const rect of allRects(geometry)) {
      expect(rect.w).toBeGreaterThanOrEqual(0);
      expect(rect.h).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.h).toBeLessThanOrEqual(HEIGHT + 1e-9);
    }
    expect(geometry.attempt[4].h).toBe(0);
  });

  it("marks nothing unmatched without pairs", () => {
    expect(allRects(geometry).some((rect) => rect.unmatched)).toBe(false);
  });

  it("marks the notes paired with nothing as unmatched", () => {
    const pairs: Array<[number | null, number | null]> = [
      [0, 0],
      [1, 1],
      [null, 2],
      [2, 1],
      [3, 1],
      [4, null],
    ];
    const paired = notesChartGeometry(ATTEMPT, TARGET, WIDTH, HEIGHT, pairs);
    expect(paired.target.map((rect) => rect.unmatched)).toEqual([false, false, true]);
    expect(paired.attempt.map((rect) => rect.unmatched)).toEqual([false, false, false, false, true]);
  });

  it("ignores pair indices that point past either series", () => {
    const paired = notesChartGeometry(ATTEMPT, TARGET, WIDTH, HEIGHT, [[9, null], [null, 9]]);
    expect(allRects(paired).some((rect) => rect.unmatched)).toBe(false);
  });

  it("handles an empty series and a single zero-length note", () => {
    expect(notesChartGeometry([], [], WIDTH, HEIGHT)).toMatchObject({ attempt: [], target: [], markers: [] });
    const single = notesChartGeometry([], [{ startS: 2, durationMs: 0, levelDb: -5 }], WIDTH, HEIGHT);
    expect(single.target).toHaveLength(1);
    for (const value of Object.values(single.target[0])) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
    expect(single.target[0]).toMatchObject({ x: 0, w: 0, y: 0, h: HEIGHT });
  });
});

describe("notesChartGeometry resonance markers", () => {
  /** Resonance 1.0-3.0 kHz runs from the bottom (y = HEIGHT) to the top (y = 0) of the plot. */
  const yFor = (hz: number): number => notesChartGeometry([note(0, 100, -10, hz)], [], WIDTH, HEIGHT).markers[0].y;

  it("puts a marker at the centre of each attempt note", () => {
    const geometry = notesChartGeometry(ATTEMPT, TARGET, WIDTH, HEIGHT);
    const attemptMarkers = geometry.markers.filter((marker) => marker.kind === "attempt");
    expect(attemptMarkers).toHaveLength(ATTEMPT.length);
    attemptMarkers.forEach((marker, i) => {
      const rect = geometry.attempt[i];
      expect(marker.x).toBeCloseTo(rect.x + rect.w / 2);
    });
  });

  it("draws no markers for the built-in shape, which has no resonance", () => {
    const geometry = notesChartGeometry(ATTEMPT, TARGET, WIDTH, HEIGHT);
    expect(geometry.markers.every((marker) => marker.kind === "attempt")).toBe(true);
  });

  it("draws reference markers for target notes that carry a resonance", () => {
    const reference: ShapeNote[] = [
      { startS: 0, durationMs: 200, levelDb: -10, resonanceHz: 2000 },
      { startS: 0.3, durationMs: 200, levelDb: -12, resonanceHz: 1500 },
    ];
    const geometry = notesChartGeometry([], reference, WIDTH, HEIGHT);
    expect(geometry.markers).toHaveLength(2);
    expect(geometry.markers.map((marker) => marker.kind)).toEqual(["reference", "reference"]);
    expect(geometry.markers[0].x).toBeCloseTo(geometry.target[0].x + geometry.target[0].w / 2);
    expect(geometry.markers[1].y).toBeGreaterThan(geometry.markers[0].y);
  });

  it("maps 1-3 kHz to the plot's height, higher resonance higher up", () => {
    expect(yFor(1000)).toBeCloseTo(HEIGHT);
    expect(yFor(2000)).toBeCloseTo(HEIGHT / 2);
    expect(yFor(3000)).toBeCloseTo(0);
    expect(yFor(2400)).toBeLessThan(yFor(1800));
  });

  it("clamps resonance outside the scale to its edges", () => {
    expect(yFor(400)).toBeCloseTo(HEIGHT);
    expect(yFor(4000)).toBeCloseTo(0);
  });

  it("skips notes whose resonance is not a finite number", () => {
    expect(notesChartGeometry([note(0, 100, -10, Number.NaN)], [], WIDTH, HEIGHT).markers).toEqual([]);
  });

  it("places the hen pitch band at 1.8-2.1 kHz on the same scale", () => {
    const { henBand } = notesChartGeometry(ATTEMPT, TARGET, WIDTH, HEIGHT);
    expect(henBand.y).toBeCloseTo(yFor(2100));
    expect(henBand.y + henBand.h).toBeCloseTo(yFor(1800));
  });
});
