import { drawTrace, pruneTrace, traceGeometry, type TraceColors, type TracePoint } from "./charts/liveTrace";
import { el } from "./dom";

/** The live display while recording: a level bar and a scrolling resonance line. */

const LEVEL_FLOOR_DB = -80;
const TRACE_WINDOW_S = 4;
const CANVAS_SIZE = { width: 640, height: 240 };

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function traceColors(): TraceColors {
  return {
    line: cssColor("--trace", "#2f6b3a"),
    band: cssColor("--hen-band", "rgba(47, 107, 58, 0.15)"),
    grid: cssColor("--track", "#dcd8cb"),
    text: cssColor("--muted", "#5d6a5f"),
  };
}

export class LiveView {
  readonly root: HTMLElement;
  private readonly levelFill: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly points: TracePoint[] = [];
  private colors: TraceColors | null = null;

  constructor() {
    this.levelFill = el("div", { class: "level-fill" });
    const levelTrack = el("div", { class: "level-track", role: "presentation" }, this.levelFill);
    this.canvas = el("canvas", {
      class: "trace",
      width: String(CANVAS_SIZE.width),
      height: String(CANVAS_SIZE.height),
      role: "img",
      "aria-label": "Live resonance of your call, 0 to 4 kHz",
    }) as HTMLCanvasElement;
    this.context = this.canvas.getContext("2d");
    this.root = el(
      "section",
      { class: "live", "aria-label": "Live display" },
      el("p", { class: "live-label" }, "Level"),
      levelTrack,
      el("p", { class: "live-label" }, "Resonance, 0 to 4 kHz. The shaded band is a hen's range, 1.8 to 2.1 kHz."),
      this.canvas,
    );
    this.root.hidden = true;
  }

  show(): void {
    this.points.length = 0;
    this.colors = traceColors();
    this.levelFill.style.width = "0%";
    this.draw(0);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  update(levelDb: number, tS: number, resonanceHz: number | null): void {
    const fraction = Math.min(1, Math.max(0, (levelDb - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB));
    this.levelFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.points.push({ tS, hz: resonanceHz });
    pruneTrace(this.points, tS, TRACE_WINDOW_S);
    this.draw(tS);
  }

  private draw(nowS: number): void {
    if (!this.context || !this.colors) return;
    const geometry = traceGeometry(this.points, { ...CANVAS_SIZE, nowS, windowS: TRACE_WINDOW_S });
    drawTrace(this.context, geometry, this.colors);
  }
}
