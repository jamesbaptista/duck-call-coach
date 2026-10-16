/** The live resonance line on the Practice screen: a scrolling trace of resonance over the last few seconds. */

export interface TracePoint {
  /** Seconds since the recording started. */
  tS: number;
  /** Resonance at that moment; null when nothing loud enough was heard. */
  hz: number | null;
}

export interface TraceOptions {
  width: number;
  height: number;
  /** The time at the right edge. */
  nowS: number;
  /** How many seconds the width spans. */
  windowS: number;
}

export interface TraceGeometry {
  /** Connected runs of points; the line breaks where there was no resonance. */
  lines: { x: number; y: number }[][];
  /** The hen range, as y coordinates (top < bottom). */
  band: { top: number; bottom: number };
  grid: { y: number; label: string }[];
}

const MAX_HZ = 4000;
const HEN_LO_HZ = 1800;
const HEN_HI_HZ = 2100;
const GRID_STEP_HZ = 1000;
/** Readings further apart than this are not joined (the display paused, or the tab was hidden). */
const MAX_JOIN_GAP_S = 0.1;

function yFor(hz: number, height: number): number {
  const clamped = Math.min(MAX_HZ, Math.max(0, hz));
  return height * (1 - clamped / MAX_HZ);
}

function gridLines(height: number): TraceGeometry["grid"] {
  const grid: TraceGeometry["grid"] = [];
  for (let hz = GRID_STEP_HZ; hz < MAX_HZ; hz += GRID_STEP_HZ) {
    grid.push({ y: yFor(hz, height), label: `${hz / 1000} kHz` });
  }
  return grid;
}

/** Where to draw everything, in canvas pixels. Pure, so it is tested without a canvas. */
export function traceGeometry(points: readonly TracePoint[], opts: TraceOptions): TraceGeometry {
  const { width, height, nowS, windowS } = opts;
  const lines: TraceGeometry["lines"] = [];
  let current: TraceGeometry["lines"][number] | null = null;
  let previousS = -Infinity;
  for (const point of points) {
    const x = width * (1 - (nowS - point.tS) / windowS);
    if (point.hz === null || x < 0) {
      current = null;
      continue;
    }
    if (current === null || point.tS - previousS > MAX_JOIN_GAP_S) {
      current = [];
      lines.push(current);
    }
    current.push({ x, y: yFor(point.hz, height) });
    previousS = point.tS;
  }
  return { lines, band: { top: yFor(HEN_HI_HZ, height), bottom: yFor(HEN_LO_HZ, height) }, grid: gridLines(height) };
}

/** Removes points that have scrolled out of the window, so the list stays small during a recording. */
export function pruneTrace(points: TracePoint[], nowS: number, windowS: number): void {
  const firstKept = points.findIndex((point) => nowS - point.tS <= windowS);
  points.splice(0, firstKept === -1 ? points.length : firstKept);
}

export interface TraceColors {
  line: string;
  band: string;
  grid: string;
  text: string;
}

/** Draws the geometry onto a canvas whose drawing size matches the options it was built with. */
export function drawTrace(context: CanvasRenderingContext2D, geometry: TraceGeometry, colors: TraceColors): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);

  context.fillStyle = colors.band;
  context.fillRect(0, geometry.band.top, width, geometry.band.bottom - geometry.band.top);

  context.strokeStyle = colors.grid;
  context.fillStyle = colors.text;
  context.lineWidth = 1;
  context.font = "22px system-ui, sans-serif";
  context.textBaseline = "bottom";
  for (const { y, label } of geometry.grid) {
    context.beginPath();
    context.moveTo(0, Math.round(y) + 0.5);
    context.lineTo(width, Math.round(y) + 0.5);
    context.stroke();
    context.fillText(label, 4, y - 2);
  }

  context.strokeStyle = colors.line;
  context.lineWidth = 3;
  context.lineJoin = "round";
  for (const line of geometry.lines) {
    context.beginPath();
    line.forEach(({ x, y }, i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    if (line.length === 1) context.lineTo(line[0].x + 1, line[0].y);
    context.stroke();
  }
}
