import type { AttemptMeta } from "../storage/db";

export interface ScoreSummary {
  count: number;
  /** The newest attempt's overall score; null when there is none or it was not judged. */
  last: number | null;
  /** The highest overall score among judged attempts. */
  best: number | null;
}

/** Last and best score for a Home tile, from the attempts' metadata in any order. */
export function summarizeScores(attempts: readonly Pick<AttemptMeta, "createdAt" | "scores">[]): ScoreSummary {
  let newest: (typeof attempts)[number] | undefined;
  let best: number | null = null;
  for (const attempt of attempts) {
    if (newest === undefined || attempt.createdAt > newest.createdAt) newest = attempt;
    const score = attempt.scores?.overall;
    if (score !== undefined && (best === null || score > best)) best = score;
  }
  return { count: attempts.length, last: newest?.scores?.overall ?? null, best };
}

/** The tile text for a summary, one line each. */
export function summaryLines(summary: ScoreSummary): string[] {
  if (summary.count === 0) return ["No attempts yet"];
  return [
    `Last: ${summary.last === null ? "not judged" : summary.last}`,
    `Best: ${summary.best === null ? "none yet" : summary.best}`,
  ];
}
