import type { CallType } from "../analysis/types";
import { CALL_TYPES, CONFIDENCES, MEASURE_KEYS, SUB_SCORES } from "./types";
import type { CallTargets, MeasureKey, MeasureTarget, SubScore } from "./types";

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(options: readonly T[], value: unknown, where: string): T {
  const match = options.find((option) => option === value);
  if (match === undefined) {
    throw new Error(`${where}: expected one of ${options.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return match;
}

function finiteNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

function nonNegative(value: unknown, where: string): number {
  const n = finiteNumber(value, where);
  if (n < 0) throw new Error(`${where}: must be 0 or more, got ${n}`);
  return n;
}

function parseMeasure(callType: CallType, raw: unknown, index: number): MeasureTarget {
  if (!isRecord(raw)) throw new Error(`${callType} measures[${index}]: expected an object`);
  const key: MeasureKey = oneOf(MEASURE_KEYS, raw["key"], `${callType} measures[${index}] key`);
  const where = (field: string): string => `${callType} ${key} ${field}`;

  const lo = finiteNumber(raw["lo"], where("lo"));
  const hi = finiteNumber(raw["hi"], where("hi"));
  if (lo > hi) throw new Error(`${where("lo")}: ${lo} is above hi (${hi})`);
  const tolerance = finiteNumber(raw["tolerance"], where("tolerance"));
  if (tolerance <= 0) throw new Error(`${where("tolerance")}: must be above 0, got ${tolerance}`);

  return {
    key,
    lo,
    hi,
    tolerance,
    weight: nonNegative(raw["weight"], where("weight")),
    sub: oneOf(SUB_SCORES, raw["sub"], where("sub")),
  };
}

function parseSubWeights(callType: CallType, raw: unknown): Record<SubScore, number> {
  if (!isRecord(raw)) throw new Error(`${callType} subWeights: expected an object`);
  const weights = {} as Record<SubScore, number>;
  for (const sub of SUB_SCORES) {
    weights[sub] = nonNegative(raw[sub], `${callType} subWeights ${sub}`);
  }
  return weights;
}

function parseCall(callType: CallType, raw: unknown): CallTargets {
  if (!isRecord(raw)) throw new Error(`${callType}: expected an object`);
  const description = raw["description"];
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`${callType} description: expected a non-empty string`);
  }
  const measures = raw["measures"];
  if (!Array.isArray(measures) || measures.length === 0) {
    throw new Error(`${callType} measures: expected a non-empty list`);
  }
  return {
    callType,
    confidence: oneOf(CONFIDENCES, raw["confidence"], `${callType} confidence`),
    description,
    measures: measures.map((measure, index) => parseMeasure(callType, measure, index)),
    subWeights: parseSubWeights(callType, raw["subWeights"]),
  };
}

/** Validates the contents of targets.json (which people may edit by hand). Throws an Error naming the bad call type and key. */
export function parseTargets(raw: unknown): Record<CallType, CallTargets> {
  if (!isRecord(raw)) throw new Error("targets: expected an object keyed by call type");
  for (const name of Object.keys(raw)) oneOf(CALL_TYPES, name, `targets: call type "${name}"`);

  const parsed = {} as Record<CallType, CallTargets>;
  for (const callType of CALL_TYPES) {
    if (!(callType in raw)) throw new Error(`targets: missing call type ${callType}`);
    parsed[callType] = parseCall(callType, raw[callType]);
  }
  return parsed;
}
