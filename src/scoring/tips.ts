import type { CallType } from "../analysis/types";
import tipsJson from "./tips.json";
import { SUB_SCORES } from "./types";
import type { MeasureKey, MeasureScore, Scores, SubScore } from "./types";

/** Tip text by key: `${callType}.${measure}.${low|high}`, `any.${measure}.${low|high}` or `positive.${sub}`. */
export type TipTable = Record<string, string>;

export type Direction = "low" | "high";

export interface SelectedTips {
  problems: string[];
  /** Empty when no sub-score could be scored. */
  positive: string;
}

const MAX_PROBLEMS = 3;
const PLACEHOLDERS: readonly string[] = ["value", "lo", "hi"];
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;
const HZ_PER_KHZ = 1000;

let cachedTips: TipTable | undefined;

function checkPlaceholders(name: string, text: string): void {
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[1] ?? "";
    if (!PLACEHOLDERS.includes(placeholder)) {
      throw new Error(`tips "${name}": unknown placeholder {${placeholder}}; use only {value}, {lo} and {hi}`);
    }
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER_PATTERN, ""))) {
    throw new Error(`tips "${name}": stray brace; write placeholders as {value}, {lo} or {hi}`);
  }
}

/** Validates the contents of tips.json (which people may edit by hand). Throws an Error naming the bad entry. */
export function parseTips(raw: unknown): TipTable {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("tips: expected an object of tip texts");
  }
  const table: TipTable = {};
  for (const [name, text] of Object.entries(raw)) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(`tips "${name}": expected a non-empty string`);
    }
    checkPlaceholders(name, text);
    table[name] = text;
  }
  return table;
}

/** The validated tip table. Reads and validates tips.json once. */
export function loadTips(): TipTable {
  cachedTips ??= parseTips(tipsJson);
  return cachedTips;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 21 -> "21st". */
function ordinal(n: number): string {
  const lastTwo = n % 100;
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : (suffixes[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Shows a measurement (or one end of its target range) the way a tip should say it. */
export function formatValue(key: MeasureKey, n: number): string {
  switch (key) {
    case "resonanceHz":
      return `${(n / HZ_PER_KHZ).toFixed(1)} kHz`;
    case "loudestIndex":
      return ordinal(Math.round(n) + 1);
    case "spacingCv":
    case "lastFirstRatio":
    case "flatness":
    case "maxSqueakShare":
      return n.toFixed(2);
    case "spacingMs":
    case "burstSpacingMs":
    case "firstNoteMs":
    case "medianNoteMs":
    case "resonanceSlopeHzPerNote":
    case "fadeDb":
    case "noteCount":
    case "longNoteCount":
      return String(Math.round(n));
  }
}

/** Which side of its target range a measure missed on; null when it is in range or was not measured. */
export function directionOf(measure: Pick<MeasureScore, "value" | "lo" | "hi">): Direction | null {
  const { value, lo, hi } = measure;
  if (value === null) return null;
  if (value < lo) return "low";
  if (value > hi) return "high";
  return null;
}

/** A call-specific tip wins over the `any.*` one. */
function tipTemplate(table: TipTable, callType: CallType, key: MeasureKey, direction: Direction): string | undefined {
  return table[`${callType}.${key}.${direction}`] ?? table[`any.${key}.${direction}`];
}

function fillTemplate(template: string, measure: MeasureScore, value: number): string {
  const replacements: Record<string, number> = { value, lo: measure.lo, hi: measure.hi };
  return template.replace(PLACEHOLDER_PATTERN, (_, name: string) => formatValue(measure.key, replacements[name] ?? value));
}

function problemText(table: TipTable, callType: CallType, measure: MeasureScore): string | null {
  const direction = directionOf(measure);
  if (direction === null || measure.value === null) return null;
  const template = tipTemplate(table, callType, measure.key, direction);
  return template === undefined ? null : fillTemplate(template, measure, measure.value);
}

/** The positive message for the highest sub-score; the first of rhythm, notes, pitch, tone wins a tie. */
function positiveText(table: TipTable, subs: Scores["subs"]): string {
  let best: SubScore | undefined;
  for (const sub of SUB_SCORES) {
    const score = subs[sub];
    if (score !== null && (best === undefined || score > (subs[best] ?? -Infinity))) best = sub;
  }
  return best === undefined ? "" : (table[`positive.${best}`] ?? "");
}

/** Plain-English coaching: the (up to) three biggest score losses that have a tip, plus a positive note. */
export function selectTips(
  callType: CallType,
  scores: Scores,
  table: TipTable = loadTips(),
): SelectedTips {
  const problems = scores.measures
    .filter((m) => m.weightedLoss > 0)
    .sort((a, b) => b.weightedLoss - a.weightedLoss)
    .flatMap((m) => problemText(table, callType, m) ?? [])
    .slice(0, MAX_PROBLEMS);
  return { problems, positive: positiveText(table, scores.subs) };
}
