import { describe, expect, it } from "vitest";
import { summarizeScores, summaryLines } from "../../src/ui/scoreSummary";
import { scoresOf } from "../helpers/records";

describe("summarizeScores", () => {
  it("is empty with no attempts", () => {
    expect(summarizeScores([])).toEqual({ count: 0, last: null, best: null });
  });

  it("takes last from the newest attempt and best from the highest score", () => {
    const attempts = [
      { createdAt: 10, scores: scoresOf(60) },
      { createdAt: 30, scores: scoresOf(72) },
      { createdAt: 20, scores: scoresOf(85) },
    ];
    expect(summarizeScores(attempts)).toEqual({ count: 3, last: 72, best: 85 });
  });

  it("gives no last score when the newest attempt was not judged, and ignores it for best", () => {
    const attempts = [
      { createdAt: 30, scores: null },
      { createdAt: 20, scores: scoresOf(40) },
    ];
    expect(summarizeScores(attempts)).toEqual({ count: 2, last: null, best: 40 });
  });
});

describe("summaryLines", () => {
  it("invites a first attempt", () => {
    expect(summaryLines({ count: 0, last: null, best: null })).toEqual(["No attempts yet"]);
  });

  it("shows last and best", () => {
    expect(summaryLines({ count: 3, last: 72, best: 85 })).toEqual(["Last: 72", "Best: 85"]);
  });

  it("says when the last attempt was not judged or nothing has been scored", () => {
    expect(summaryLines({ count: 1, last: null, best: null })).toEqual(["Last: not judged", "Best: none yet"]);
  });
});
