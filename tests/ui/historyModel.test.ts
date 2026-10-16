import { describe, expect, it } from "vitest";
import {
  attemptStatus,
  chartDescription,
  chartPoints,
  deleteCallQuestion,
  formatAttemptDate,
  restoreResultText,
} from "../../src/ui/screens/history/model";
import { analysisOf, attempt, scoresOf } from "../helpers/records";

const UTC_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

const scored = (id: string, createdAt: number, overall: number) => attempt(id, "hail", createdAt, { scores: scoresOf(overall) });
const notJudged = (id: string, createdAt: number) =>
  attempt(id, "hail", createdAt, { scores: null, analysis: { ...analysisOf("hail", null), quality: "too_quiet" } });
const failed = (id: string, createdAt: number) =>
  attempt(id, "hail", createdAt, { scores: null, analysis: analysisOf("hail", null) });

describe("attemptStatus", () => {
  it("shows a scored attempt's overall score as a whole number", () => {
    expect(attemptStatus(scored("a", 1, 71.6))).toEqual({ kind: "scored", text: "Score 72" });
  });

  it("says an attempt with a quality issue was not judged", () => {
    expect(attemptStatus(notJudged("a", 1))).toEqual({ kind: "not-judged", text: "Not judged" });
  });

  it("says an attempt whose analysis failed couldn't be analysed", () => {
    expect(attemptStatus(failed("a", 1))).toEqual({ kind: "failed", text: "Couldn't analyse" });
  });
});

describe("chartPoints", () => {
  it("keeps only scored attempts, oldest first", () => {
    const attempts = [scored("c", 30, 80), failed("x", 25), scored("a", 10, 40), notJudged("y", 15), scored("b", 20, 60)];
    expect(chartPoints(attempts)).toEqual([
      { t: 10, score: 40 },
      { t: 20, score: 60 },
      { t: 30, score: 80 },
    ]);
  });

  it("is empty when nothing was scored", () => {
    expect(chartPoints([failed("x", 1), notJudged("y", 2)])).toEqual([]);
  });

  it("leaves out a score that isn't a finite number", () => {
    expect(chartPoints([scored("a", 1, Number.NaN), scored("b", 2, 50)])).toEqual([{ t: 2, score: 50 }]);
  });
});

describe("formatAttemptDate", () => {
  it("formats the time an attempt was made", () => {
    expect(formatAttemptDate(Date.UTC(2026, 9, 16, 6, 5), UTC_FORMAT)).toBe("Oct 16, 2026, 6:05 AM");
  });

  it("says the date is unknown when it can't be shown", () => {
    expect(formatAttemptDate(Number.NaN, UTC_FORMAT)).toBe("unknown date");
    expect(formatAttemptDate(Number.POSITIVE_INFINITY, UTC_FORMAT)).toBe("unknown date");
    expect(formatAttemptDate(9e15, UTC_FORMAT)).toBe("unknown date");
  });
});

describe("chartDescription", () => {
  it("describes the scores for a screen reader", () => {
    const points = [
      { t: 1, score: 40 },
      { t: 2, score: 85 },
      { t: 3, score: 71.6 },
    ];
    expect(chartDescription(points)).toBe(
      "Your scores over time, oldest on the left: 3 scored attempts. Latest 72, best 85, out of 100.",
    );
  });

  it("uses the singular for one attempt", () => {
    expect(chartDescription([{ t: 1, score: 50 }])).toBe(
      "Your scores over time, oldest on the left: 1 scored attempt. Latest 50, best 50, out of 100.",
    );
  });
});

describe("deleteCallQuestion", () => {
  it("names the call and the number of attempts", () => {
    expect(deleteCallQuestion("Quack", 3)).toBe(
      "Delete all 3 Quack attempts? Their recordings and scores can't be brought back.",
    );
  });

  it("uses the singular for one attempt", () => {
    expect(deleteCallQuestion("Feed Chuckle", 1)).toBe(
      "Delete your 1 Feed Chuckle attempt? Its recording and score can't be brought back.",
    );
  });
});

describe("restoreResultText", () => {
  it("says how many records were added and skipped", () => {
    expect(restoreResultText({ added: 12, skipped: 3 })).toBe("Added 12, skipped 3.");
  });
});
