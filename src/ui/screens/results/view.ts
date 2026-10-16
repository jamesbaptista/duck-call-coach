import type { Note, QualityIssue } from "../../../analysis/types";
import { SUB_SCORES, type Confidence, type Scores } from "../../../scoring/types";
import type { AttemptRecord } from "../../../storage/db";
import { NOTES_CHART_PLOT, notesChartGeometry, renderNotesChart } from "../../charts/notesChart";
import { el } from "../../dom";
import { confidenceText, SUB_SCORE_NAMES } from "../../labels";
import { chartDescription, QUALITY_MESSAGES, subScoreText, type ChartTarget } from "./model";

/** DOM pieces of the Results screen. Every string goes in as text, never as HTML. */

export function notices(lines: readonly string[]): HTMLElement[] {
  return lines.map((line) => el("p", { class: "notice" }, line));
}

export function scoresView(scores: Scores, confidence: Confidence): HTMLElement {
  const subs = SUB_SCORES.map((sub) =>
    el(
      "div",
      { class: "sub-score" },
      el("dt", {}, SUB_SCORE_NAMES[sub]),
      el("dd", {}, subScoreText(scores.subs[sub])),
    ),
  );
  return el(
    "section",
    { class: "score-card", "aria-label": "Scores" },
    el(
      "p",
      { class: "overall" },
      el("span", { class: "overall-value" }, String(scores.overall)),
      el("span", { class: "overall-unit" }, "out of 100"),
    ),
    el("dl", { class: "sub-scores" }, ...subs),
    el("p", { class: "badge" }, confidenceText(confidence)),
  );
}

export function qualityView(issue: QualityIssue): HTMLElement {
  return el("p", { class: "quality-message" }, QUALITY_MESSAGES[issue]);
}

/** Problems first (biggest first, as stored), then the positive line when there is one. */
export function tipsView(tips: AttemptRecord["tips"]): HTMLElement | null {
  const parts: HTMLElement[] = [];
  if (tips.problems.length > 0) {
    parts.push(
      el("h2", {}, "What to work on"),
      el("ul", { class: "tips" }, ...tips.problems.map((problem) => el("li", {}, problem))),
    );
  }
  if (tips.positive) parts.push(el("h2", {}, "What went well"), el("p", { class: "positive" }, tips.positive));
  return parts.length > 0 ? el("section", { class: "tips-section" }, ...parts) : null;
}

function legendItem(swatch: string, label: string): HTMLElement {
  return el("li", {}, el("span", { class: `swatch ${swatch}`, "aria-hidden": "true" }), label);
}

export function chartView(attemptNotes: Note[], target: ChartTarget): HTMLElement {
  const { width, height } = NOTES_CHART_PLOT;
  const geometry = notesChartGeometry(attemptNotes, target.shape, width, height, target.pairs);
  const unmatched = [...geometry.attempt, ...geometry.target].filter((rect) => rect.unmatched).length;
  const description = chartDescription({
    attemptNotes: attemptNotes.length,
    targetNotes: target.shape.length,
    unmatched,
    usesReference: target.usesReference,
  });
  const legend = el(
    "ul",
    { class: "chart-legend" },
    legendItem("swatch-attempt", "Your notes"),
    legendItem("swatch-target", target.usesReference ? "Your reference" : "Hen target"),
  );
  if (unmatched > 0) legend.append(legendItem("swatch-unmatched", "No partner: an extra or a missed note"));
  legend.append(legendItem("swatch-dot", "Your pitch (1-3 kHz scale, right)"));
  if (geometry.markers.some((marker) => marker.kind === "reference")) {
    legend.append(legendItem("swatch-ring", "Your reference's pitch"));
  }
  legend.append(legendItem("swatch-band", "Hen pitch, 1.8-2.1 kHz"));
  return el(
    "section",
    { class: "chart-section" },
    el("h2", {}, "Your notes and the target"),
    renderNotesChart(geometry, description),
    legend,
  );
}
