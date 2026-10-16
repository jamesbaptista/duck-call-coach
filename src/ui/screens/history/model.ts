import type { AttemptMeta } from "../../../storage/db";
import { isAnalysisFailed } from "../../attempt";
import type { ScorePoint } from "../../charts/historyChart";

/** What the History screen shows, worked out without the DOM. */

export interface AttemptStatus {
  kind: "scored" | "not-judged" | "failed";
  text: string;
}

const UNKNOWN_DATE = "unknown date";

/** A row's right-hand side: the score, or why there is none. */
export function attemptStatus(attempt: Pick<AttemptMeta, "analysis" | "scores">): AttemptStatus {
  if (attempt.scores !== null) return { kind: "scored", text: `Score ${Math.round(attempt.scores.overall)}` };
  if (isAnalysisFailed(attempt)) return { kind: "failed", text: "Couldn't analyse" };
  return { kind: "not-judged", text: "Not judged" };
}

/** The chart's points: scored attempts only (not judged and failed ones have no score), oldest first. */
export function chartPoints(attempts: readonly Pick<AttemptMeta, "createdAt" | "scores">[]): ScorePoint[] {
  return attempts
    .flatMap((attempt) => {
      const score = attempt.scores?.overall;
      return score !== undefined && Number.isFinite(score) ? [{ t: attempt.createdAt, score }] : [];
    })
    .sort((a, b) => a.t - b.t);
}

/** When an attempt was made, or "unknown date" when the stored time can't be shown. */
export function formatAttemptDate(createdAt: number, format: Intl.DateTimeFormat): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? UNKNOWN_DATE : format.format(date);
}

/** The chart's text alternative. `points` must be oldest first and not empty. */
export function chartDescription(points: readonly ScorePoint[]): string {
  const count = points.length;
  const latest = Math.round(points[count - 1].score);
  const best = Math.round(Math.max(...points.map((p) => p.score)));
  const attempts = count === 1 ? "1 scored attempt" : `${count} scored attempts`;
  return `Your scores over time, oldest on the left: ${attempts}. Latest ${latest}, best ${best}, out of 100.`;
}

/** The confirm() question before deleting every attempt for one call. */
export function deleteCallQuestion(callName: string, count: number): string {
  return count === 1
    ? `Delete your 1 ${callName} attempt? Its recording and score can't be brought back.`
    : `Delete all ${count} ${callName} attempts? Their recordings and scores can't be brought back.`;
}

export function restoreResultText(result: { added: number; skipped: number }): string {
  return `Added ${result.added}, skipped ${result.skipped}.`;
}
