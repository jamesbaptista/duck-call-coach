import type { CallMeasurements, CallType } from "../analysis/types";
import targetsJson from "./targets.json";
import { parseTargets } from "./targetsSchema";
import { SUB_SCORES } from "./types";
import type { CallTargets, MeasureScore, MeasureTarget, Scores, SubScore } from "./types";

const FULL_SCORE = 100;

let cachedTargets: Record<CallType, CallTargets> | undefined;

/** The validated targets for one call type. Reads and validates targets.json once. */
export function loadTargets(callType: CallType): CallTargets {
  cachedTargets ??= parseTargets(targetsJson);
  return cachedTargets[callType];
}

/** 100 inside [lo, hi]; outside, falls linearly to 0 at one tolerance away. */
export function scoreMeasure(value: number, target: Pick<MeasureTarget, "lo" | "hi" | "tolerance">): number {
  const distance = Math.max(target.lo - value, value - target.hi, 0);
  return FULL_SCORE * Math.max(0, 1 - distance / target.tolerance);
}

/** Weighted mean of the entries' scores; null when there is nothing to average. */
function weightedMean(entries: { score: number; weight: number }[]): number | null {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight === 0) return null;
  return entries.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight;
}

/** A sub-score is the weighted mean of its measures that could be scored. `scores[i]` belongs to `targets[i]`. */
function scoreSub(sub: SubScore, targets: MeasureTarget[], scores: MeasureScore[]): number | null {
  const entries = targets.flatMap((t, i) => {
    const score = scores[i]?.score ?? null;
    return t.sub === sub && score !== null ? [{ score, weight: t.weight }] : [];
  });
  return weightedMean(entries);
}

function scoreOneMeasure(m: CallMeasurements, target: MeasureTarget, subWeight: number): MeasureScore {
  const value = m[target.key];
  const score = value === null ? null : scoreMeasure(value, target);
  const weightedLoss = score === null ? 0 : (FULL_SCORE - score) * target.weight * subWeight;
  return { key: target.key, sub: target.sub, value, lo: target.lo, hi: target.hi, score, weightedLoss };
}

/** Overall: weighted mean of the sub-scores that exist, by `subWeights`; 0 when none count. */
function overallScore(subs: Record<SubScore, number | null>, subWeights: Record<SubScore, number>): number {
  const entries = SUB_SCORES.flatMap((sub) => {
    const score = subs[sub];
    return score === null ? [] : [{ score, weight: subWeights[sub] }];
  });
  return Math.round(weightedMean(entries) ?? 0);
}

/** Scores one attempt against a call type's targets. Measurements that are null are skipped, not scored 0. */
export function scoreAttempt(m: CallMeasurements, targets: CallTargets): Scores {
  const measures = targets.measures.map((t) => scoreOneMeasure(m, t, targets.subWeights[t.sub]));
  const subs = {} as Record<SubScore, number | null>;
  for (const sub of SUB_SCORES) subs[sub] = scoreSub(sub, targets.measures, measures);
  return { overall: overallScore(subs, targets.subWeights), subs, measures };
}
