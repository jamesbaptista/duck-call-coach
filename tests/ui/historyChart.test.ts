import { describe, expect, it } from "vitest";
import { historyChartGeometry } from "../../src/ui/charts/historyChart";

const WIDTH = 300;
const HEIGHT = 160;

describe("historyChartGeometry", () => {
  it("maps scores 0, 50 and 100 to the bottom, middle and top, with x increasing in time order", () => {
    const points = [
      { t: 1_000, score: 0 },
      { t: 2_000, score: 50 },
      { t: 3_000, score: 100 },
    ];
    expect(historyChartGeometry(points, WIDTH, HEIGHT)).toEqual([
      { x: 0, y: HEIGHT },
      { x: WIDTH / 2, y: HEIGHT / 2 },
      { x: WIDTH, y: 0 },
    ]);
  });

  it("gives [] for an empty list", () => {
    expect(historyChartGeometry([], WIDTH, HEIGHT)).toEqual([]);
  });

  it("centres a single point on x", () => {
    expect(historyChartGeometry([{ t: 5, score: 75 }], WIDTH, HEIGHT)).toEqual([{ x: WIDTH / 2, y: HEIGHT / 4 }]);
  });

  it("returns the points oldest first whatever order they come in, without changing the input", () => {
    const points = [
      { t: 30, score: 100 },
      { t: 10, score: 0 },
      { t: 20, score: 50 },
    ];
    const copy = structuredClone(points);
    expect(historyChartGeometry(points, WIDTH, HEIGHT)).toEqual([
      { x: 0, y: HEIGHT },
      { x: WIDTH / 2, y: HEIGHT / 2 },
      { x: WIDTH, y: 0 },
    ]);
    expect(points).toEqual(copy);
  });

  it("spaces points evenly by order, not by elapsed time", () => {
    const points = [
      { t: 0, score: 10 },
      { t: 1, score: 20 },
      { t: 1_000_000, score: 30 },
    ];
    expect(historyChartGeometry(points, WIDTH, HEIGHT).map((p) => p.x)).toEqual([0, WIDTH / 2, WIDTH]);
  });

  it("keeps the given order for attempts made at the same moment", () => {
    const points = [
      { t: 7, score: 20 },
      { t: 7, score: 80 },
    ];
    expect(historyChartGeometry(points, WIDTH, HEIGHT)).toEqual([
      { x: 0, y: HEIGHT * 0.8 },
      { x: WIDTH, y: HEIGHT * 0.2 },
    ]);
  });

  it("keeps out-of-range scores inside the plot", () => {
    const ys = historyChartGeometry(
      [
        { t: 1, score: -20 },
        { t: 2, score: 140 },
      ],
      WIDTH,
      HEIGHT,
    ).map((p) => p.y);
    expect(ys).toEqual([HEIGHT, 0]);
  });
});
