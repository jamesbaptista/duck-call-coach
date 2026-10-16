/**
 * The History chart: each scored attempt's overall score (0-100, up) in the order the attempts were made
 * (oldest on the left), as dots joined by a line.
 */

export interface ScorePoint {
  /** When the attempt was made (ms since the epoch); only the order matters. */
  t: number;
  /** Overall score, 0-100. */
  score: number;
}

export interface PlotPoint {
  x: number;
  y: number;
}

const MAX_SCORE = 100;

function clampScore(score: number): number {
  return Math.min(MAX_SCORE, Math.max(0, score));
}

/**
 * Plot positions in a `width` × `height` area (y grows downwards, so a score of 100 is y = 0), returned oldest
 * first. Points are spaced evenly in time order rather than by elapsed time, so a burst of attempts in one session
 * stays readable next to weeks of gaps. A single point is centred; attempts with the same time keep their order.
 */
export function historyChartGeometry(points: readonly ScorePoint[], width: number, height: number): PlotPoint[] {
  const ordered = [...points].sort((a, b) => a.t - b.t);
  const last = ordered.length - 1;
  return ordered.map((point, i) => ({
    x: last === 0 ? width / 2 : (i / last) * width,
    y: (height * (MAX_SCORE - clampScore(point.score))) / MAX_SCORE,
  }));
}

/**
 * The plot area in SVG user units. The whole chart is about 330 units wide, so on a 360 px phone (about 324 px
 * inside the border) one unit is about one pixel, so the chart's text keeps its size.
 */
export const HISTORY_CHART_PLOT = { width: 276, height: 150 } as const;

/** Room for the 0/50/100 labels on the left and "oldest"/"newest" below. */
const MARGIN = { top: 12, right: 14, bottom: 30, left: 40 } as const;
const DOT_RADIUS = 4.5;
const SCORE_TICKS = [0, 50, 100] as const;
/** 16 units of text: about 15.7 px on a 360 px phone, where the chart is drawn at 0.98 px per unit. */
const TEXT = { class: "history-chart-text" } as const;
const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Score gridlines and their labels. */
function scoreScale(width: number, height: number): SVGElement[] {
  return SCORE_TICKS.flatMap((score) => {
    const y = (height * (MAX_SCORE - score)) / MAX_SCORE;
    return [
      svg("line", { class: score === 0 ? "chart-axis" : "chart-grid", x1: 0, y1: y, x2: width, y2: y }),
      svg("text", { ...TEXT, x: -8, y, "text-anchor": "end", "dominant-baseline": "middle" }, String(score)),
    ];
  });
}

/**
 * Draws the plot points (computed for HISTORY_CHART_PLOT) as an SVG that scales to its container's width.
 * Colours come from CSS classes in styles.css; `description` is read out by screen readers.
 */
export function renderHistoryChart(points: readonly PlotPoint[], description: string): SVGSVGElement {
  const { width, height } = HISTORY_CHART_PLOT;
  const root = svg("svg", {
    class: "history-chart",
    viewBox: `0 0 ${MARGIN.left + width + MARGIN.right} ${MARGIN.top + height + MARGIN.bottom}`,
    role: "img",
    "aria-label": description,
  });
  const plot = svg("g", { transform: `translate(${MARGIN.left} ${MARGIN.top})` });
  plot.append(
    ...scoreScale(width, height),
    svg("polyline", {
      class: "chart-score-line",
      points: points.map((p) => `${p.x},${p.y}`).join(" "),
      "vector-effect": "non-scaling-stroke",
    }),
    ...points.map((p) => svg("circle", { class: "chart-score-dot", cx: p.x, cy: p.y, r: DOT_RADIUS })),
    svg("text", { ...TEXT, x: 0, y: height + 23 }, "oldest"),
    svg("text", { ...TEXT, x: width, y: height + 23, "text-anchor": "end" }, "newest"),
  );
  root.append(plot);
  return root;
}
