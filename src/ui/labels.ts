import type { CallType } from "../analysis/types";
import type { Confidence, SubScore } from "../scoring/types";

/** What each call is called on screen. */
export const CALL_NAMES: Record<CallType, string> = {
  quack: "Quack",
  hail: "Greeting / Hail",
  chuckle: "Feed Chuckle",
  comeback: "Comeback",
};

/** Home tile order. */
export const HOME_CALL_ORDER: readonly CallType[] = ["quack", "hail", "chuckle", "comeback"];

/** Sub-score names, in the order the Results screen lists them. */
export const SUB_SCORE_NAMES: Record<SubScore, string> = {
  rhythm: "Rhythm",
  notes: "Notes",
  pitch: "Pitch",
  tone: "Tone",
};

const CONFIDENCE_NAMES: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };

/** "Target confidence: High". How sure the app is about the built-in target for this call. */
export function confidenceText(confidence: Confidence): string {
  return `Target confidence: ${CONFIDENCE_NAMES[confidence]}`;
}
