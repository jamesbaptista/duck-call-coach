import { describe, expect, it } from "vitest";
import { pruneTrace, traceGeometry, type TracePoint } from "../../src/ui/charts/liveTrace";

const SIZE = { width: 400, height: 200, windowS: 4 };

describe("traceGeometry", () => {
  it("places the newest point at the right edge and scales 0-4 kHz to the full height", () => {
    const points: TracePoint[] = [
      { tS: 0.875, hz: 0 },
      { tS: 0.9375, hz: 2000 },
      { tS: 1, hz: 4000 },
    ];
    const { lines } = traceGeometry(points, { ...SIZE, windowS: 0.125, nowS: 1 });
    expect(lines).toEqual([
      [
        { x: 0, y: 200 },
        { x: 200, y: 100 },
        { x: 400, y: 0 },
      ],
    ]);
  });

  it("clamps resonance outside 0-4 kHz to the edges", () => {
    const points: TracePoint[] = [
      { tS: 9.95, hz: 5000 },
      { tS: 10, hz: -100 },
    ];
    const ys = traceGeometry(points, { ...SIZE, nowS: 10 }).lines[0].map((p) => p.y);
    expect(ys).toEqual([0, 200]);
  });

  it("breaks the line where there is no resonance or a long gap", () => {
    const points: TracePoint[] = [
      { tS: 7, hz: 2000 },
      { tS: 7.01, hz: 2000 },
      { tS: 7.02, hz: null },
      { tS: 7.03, hz: 1900 },
      { tS: 7.04, hz: 1900 },
      { tS: 8, hz: 1800 },
    ];
    const { lines } = traceGeometry(points, { ...SIZE, nowS: 10 });
    expect(lines.map((line) => line.length)).toEqual([2, 2, 1]);
  });

  it("leaves out points that have scrolled off the left edge", () => {
    const points: TracePoint[] = [
      { tS: 1, hz: 2000 },
      { tS: 9, hz: 2000 },
    ];
    const { lines } = traceGeometry(points, { ...SIZE, nowS: 10 });
    expect(lines).toEqual([[{ x: 300, y: 100 }]]);
  });

  it("draws the hen band from 1.8 to 2.1 kHz and grid lines at each kHz", () => {
    const { band, grid } = traceGeometry([], { ...SIZE, nowS: 0 });
    expect(band.top).toBeCloseTo(200 * (1 - 2100 / 4000));
    expect(band.bottom).toBeCloseTo(200 * (1 - 1800 / 4000));
    expect(grid).toEqual([
      { y: 150, label: "1 kHz" },
      { y: 100, label: "2 kHz" },
      { y: 50, label: "3 kHz" },
    ]);
  });
});

describe("pruneTrace", () => {
  it("drops points older than the window, in place", () => {
    const points: TracePoint[] = [
      { tS: 1, hz: 2000 },
      { tS: 5, hz: 2000 },
      { tS: 9, hz: null },
    ];
    pruneTrace(points, 10, 4);
    expect(points).toEqual([{ tS: 9, hz: null }]);
  });
});
