import type { Note } from "../../analysis/types";
import type { ShapeNote } from "./targetShape";

/**
 * The Results chart: your notes (filled) over the target's shape (outlined), time across and loudness up.
 * Each note's resonance (pitch) is a dot on a second vertical scale, 1-3 kHz, with a hen's range shaded.
 */

/** A note's box in plot coordinates (y grows downwards). `unmatched`: no partner in the other series. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  unmatched: boolean;
}

/** A note's resonance, at the centre of its box on the 1-3 kHz scale. */
export interface Marker {
  x: number;
  y: number;
  kind: "attempt" | "reference";
}

/** A horizontal strip of the plot, in the same coordinates as the rects. */
export interface Band {
  y: number;
  h: number;
}

export interface NotesChartGeometry {
  attempt: Rect[];
  target: Rect[];
  markers: Marker[];
  /** A hen's resonance range on the resonance scale. */
  henBand: Band;
}

/** Attempt index, target index; null on one side means that note has no partner (see pairNotes). */
export type ChartPair = [number | null, number | null];

/** Heights run from this many dB below a series' loudest note (zero height) up to the loudest (full height). */
const LEVEL_RANGE_DB = 40;
/** Used when neither series has any length in time, so nothing divides by zero. */
const FALLBACK_SPAN_S = 1;
const MS_PER_S = 1000;
/** The resonance scale: the bottom of the plot to the top. */
const RESONANCE_SCALE_HZ = { lo: 1000, hi: 3000 } as const;
/** A hen's resonance (spec section 5, the quack's 1.8-2.1 kHz), shaded as "hen pitch". */
export const HEN_PITCH_HZ = { lo: 1800, hi: 2100 } as const;

interface Bar {
  startS: number;
  durationMs: number;
  levelDb: number;
  resonanceHz?: number;
}

interface SeriesExtent {
  firstS: number;
  spanS: number;
  maxDb: number;
}

function extent(bars: readonly Bar[]): SeriesExtent {
  if (bars.length === 0) return { firstS: 0, spanS: 0, maxDb: 0 };
  const firstS = Math.min(...bars.map((bar) => bar.startS));
  const endS = Math.max(...bars.map((bar) => bar.startS + bar.durationMs / MS_PER_S));
  return { firstS, spanS: endS - firstS, maxDb: Math.max(...bars.map((bar) => bar.levelDb)) };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toRects(
  bars: readonly Bar[],
  series: SeriesExtent,
  pxPerS: number,
  height: number,
  unmatched: ReadonlySet<number>,
): Rect[] {
  return bars.map((bar, i) => {
    const h = clamp01((bar.levelDb - (series.maxDb - LEVEL_RANGE_DB)) / LEVEL_RANGE_DB) * height;
    return {
      x: (bar.startS - series.firstS) * pxPerS,
      y: height - h,
      w: Math.max(0, (bar.durationMs / MS_PER_S) * pxPerS),
      h,
      unmatched: unmatched.has(i),
    };
  });
}

function resonanceY(hz: number, height: number): number {
  return height * (1 - clamp01((hz - RESONANCE_SCALE_HZ.lo) / (RESONANCE_SCALE_HZ.hi - RESONANCE_SCALE_HZ.lo)));
}

/** A marker for each bar with a finite resonance, at the centre of its rect. */
function toMarkers(bars: readonly Bar[], rects: readonly Rect[], kind: Marker["kind"], height: number): Marker[] {
  return bars.flatMap((bar, i) => {
    const hz = bar.resonanceHz;
    if (hz === undefined || !Number.isFinite(hz)) return [];
    return [{ x: rects[i].x + rects[i].w / 2, y: resonanceY(hz, height), kind }];
  });
}

/** The indices on one side of the pairs whose partner is null. */
function unpaired(pairs: readonly ChartPair[], side: 0 | 1): Set<number> {
  const other = side === 0 ? 1 : 0;
  const indices = new Set<number>();
  for (const pair of pairs) {
    const index = pair[side];
    if (index !== null && pair[other] === null) indices.add(index);
  }
  return indices;
}

/**
 * Boxes for the attempt's notes and the target's notes in a `width` × `height` plot. Both series share one
 * time axis, each starting at its own first onset; each series' loudest note is full height. With `pairs`
 * (reference mode, from pairNotes), notes paired with null are marked unmatched. Resonance markers sit at
 * each box's centre on a 1-3 kHz scale (clamped); built-in shape notes have no resonance, so no markers.
 */
export function notesChartGeometry(
  attempt: Note[],
  target: ShapeNote[],
  width: number,
  height: number,
  pairs: Array<[number | null, number | null]> = [],
): NotesChartGeometry {
  const attemptBars: Bar[] = attempt.map((note) => ({ ...note, levelDb: note.peakDb }));
  const attemptExtent = extent(attemptBars);
  const targetExtent = extent(target);
  const spanS = Math.max(attemptExtent.spanS, targetExtent.spanS);
  const pxPerS = width / (spanS > 0 ? spanS : FALLBACK_SPAN_S);
  const attemptRects = toRects(attemptBars, attemptExtent, pxPerS, height, unpaired(pairs, 0));
  const targetRects = toRects(target, targetExtent, pxPerS, height, unpaired(pairs, 1));
  const bandTop = resonanceY(HEN_PITCH_HZ.hi, height);
  return {
    attempt: attemptRects,
    target: targetRects,
    markers: [
      ...toMarkers(attemptBars, attemptRects, "attempt", height),
      ...toMarkers(target, targetRects, "reference", height),
    ],
    henBand: { y: bandTop, h: resonanceY(HEN_PITCH_HZ.lo, height) - bandTop },
  };
}

/** The plot area the Results screen computes its geometry for, in SVG user units. */
export const NOTES_CHART_PLOT = { width: 600, height: 220 } as const;

/** Room for the "loudness" label on the left, the kHz scale on the right and "time" below. */
const MARGIN = { top: 14, right: 84, bottom: 48, left: 44 } as const;
/** Very quiet or very short notes still get a visible sliver. */
const MIN_BAR = 3;
const DOT_RADIUS = 8;
/** Reference rings are larger than your dots, so a matching pitch shows as a dot inside a ring. */
const RING_RADIUS = 12;
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

function bar(rect: Rect, kind: "attempt" | "target", plotHeight: number): SVGRectElement {
  const h = Math.max(rect.h, MIN_BAR);
  const classes = rect.unmatched ? `chart-${kind} chart-unmatched` : `chart-${kind}`;
  return svg("rect", {
    class: classes,
    x: rect.x,
    y: Math.min(rect.y, plotHeight - h),
    width: Math.max(rect.w, MIN_BAR),
    height: h,
    "vector-effect": "non-scaling-stroke",
  });
}

function marker(point: Marker): SVGCircleElement {
  const ring = point.kind === "reference";
  return svg("circle", {
    class: ring ? "chart-marker chart-marker-reference" : "chart-marker",
    cx: point.x,
    cy: point.y,
    r: ring ? RING_RADIUS : DOT_RADIUS,
  });
}

/** The hen pitch band and its label, across the whole plot. */
function henBand(band: Band, width: number): SVGElement[] {
  return [
    svg("rect", { class: "chart-hen-band", x: 0, y: band.y, width, height: band.h }),
    svg("text", { class: "chart-band-label", x: 6, y: band.y - 6 }, "hen pitch"),
  ];
}

/** The resonance scale on the right: an axis line with 1, 2 and 3 kHz marks. */
function resonanceScale(width: number, height: number): SVGElement[] {
  const ticks = [
    { label: "3 kHz", y: 0 },
    { label: "2 kHz", y: height / 2 },
    { label: "1 kHz", y: height },
  ];
  return [
    svg("line", { class: "chart-axis chart-axis-pitch", x1: width, y1: 0, x2: width, y2: height }),
    ...ticks.map((tick) =>
      svg("text", { class: "chart-tick", x: width + 8, y: tick.y, "dominant-baseline": "middle" }, tick.label),
    ),
  ];
}

/**
 * Draws the geometry (computed for NOTES_CHART_PLOT) as an SVG that scales to its container's width.
 * Colours come from CSS classes in styles.css; `description` is read out by screen readers.
 */
export function renderNotesChart(geometry: NotesChartGeometry, description: string): SVGSVGElement {
  const { width, height } = NOTES_CHART_PLOT;
  const root = svg("svg", {
    class: "notes-chart",
    viewBox: `0 0 ${MARGIN.left + width + MARGIN.right} ${MARGIN.top + height + MARGIN.bottom}`,
    role: "img",
    "aria-label": description,
  });
  const plot = svg("g", { transform: `translate(${MARGIN.left} ${MARGIN.top})` });
  // Back to front: bars, the target outlines, the translucent hen band, axes, then the pitch markers on top.
  plot.append(
    ...geometry.attempt.map((rect) => bar(rect, "attempt", height)),
    ...geometry.target.map((rect) => bar(rect, "target", height)),
    ...henBand(geometry.henBand, width),
    svg("line", { class: "chart-axis", x1: 0, y1: height, x2: width, y2: height }),
    svg("line", { class: "chart-axis", x1: 0, y1: 0, x2: 0, y2: height }),
    ...resonanceScale(width, height),
    ...geometry.markers.map(marker),
    svg("text", { class: "chart-label", x: width / 2, y: height + 36, "text-anchor": "middle" }, "time"),
    svg(
      "text",
      { class: "chart-label", transform: `translate(-16 ${height / 2}) rotate(-90)`, "text-anchor": "middle" },
      "loudness",
    ),
  );
  root.append(plot);
  return root;
}
