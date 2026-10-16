import "./diagnostics.css";
import {
  startRecording,
  type ProcessingReport,
  type RecordingResult,
  type RecordingSession,
} from "../capture/recorder";
import { AutoStop } from "../capture/autostop";
import { averageSpectrum } from "./diagnostics-spectrum";
import { describeCaptureError } from "./capture-error";

const LEVEL_BAR_MIN_DB = -80;
const SPECTRUM_MAX_HZ = 6000;
const SPECTRUM_RANGE_DB = 80;
const SPECTRUM_SIZE = { width: 640, height: 240 };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  return node;
}

function formatFlag(value: boolean | null): string {
  if (value === null) return "not reported";
  return value ? "on" : "off";
}

function formatDb(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : "silent";
}

function peakDb(pcm: Float32Array): number {
  let peak = 0;
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

function drawSpectrum(canvas: HTMLCanvasElement, result: RecordingResult): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { magnitudeDb, binHz } = averageSpectrum(result.pcm, result.sampleRate, SPECTRUM_MAX_HZ);
  const { width, height } = canvas;
  const styles = getComputedStyle(document.documentElement);
  const line = styles.getPropertyValue("--accent");
  const text = styles.getPropertyValue("--muted");
  const grid = styles.getPropertyValue("--track");

  context.clearRect(0, 0, width, height);
  context.font = "12px system-ui, sans-serif";
  context.fillStyle = text;
  context.strokeStyle = grid;
  context.lineWidth = 1;
  for (let khz = 0; khz * 1000 <= SPECTRUM_MAX_HZ; khz++) {
    const x = Math.round((khz * 1000 * width) / SPECTRUM_MAX_HZ) + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height - 16);
    context.stroke();
    context.textAlign = khz === 0 ? "left" : khz * 1000 === SPECTRUM_MAX_HZ ? "right" : "center";
    context.fillText(`${khz} kHz`, x, height - 3);
  }

  let topDb = -Infinity;
  for (const db of magnitudeDb) topDb = Math.max(topDb, db);
  const plotHeight = height - 20;
  context.strokeStyle = line;
  context.lineWidth = 2;
  context.beginPath();
  magnitudeDb.forEach((db, bin) => {
    const x = (bin * binHz * width) / SPECTRUM_MAX_HZ;
    const fraction = Math.min(1, Math.max(0, (db - (topDb - SPECTRUM_RANGE_DB)) / SPECTRUM_RANGE_DB));
    const y = plotHeight * (1 - fraction);
    if (bin === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function addRow(list: HTMLElement, label: string, value: string, className?: string): void {
  list.append(element("dt", { text: label }), element("dd", { text: value, className }));
}

function processingVerdict(report: ProcessingReport): { text: string; good: boolean } {
  if (report.processingOff) {
    return { text: "Voice processing is off. Your phone is giving the app the raw sound.", good: true };
  }
  return {
    text: "Voice processing may still be on. The phone could be changing your sound, so measurements may be off.",
    good: false,
  };
}

function buildPage(root: HTMLElement) {
  const title = element("h1", { text: "Mic check" });
  const intro = element("p", {
    className: "muted",
    text: "Record a few seconds of duck calling. This page shows whether your phone really turned off its voice processing, and what the recording looks like.",
  });
  const button = element("button", { className: "record-button", text: "Record" });
  button.type = "button";
  const status = element("p", { className: "status" });
  status.setAttribute("role", "status");

  const processingSection = element("section", { className: "panel" });
  processingSection.hidden = true;
  const levelTrack = element("div", { className: "level-track" });
  const levelFill = element("div", { className: "level-fill" });
  levelTrack.append(levelFill);
  const levelText = element("p", { className: "muted" });
  const liveSection = element("section");
  liveSection.hidden = true;
  liveSection.append(element("h2", { text: "Level" }), levelTrack, levelText);

  const resultsSection = element("section");
  resultsSection.hidden = true;
  const resultList = element("dl", { className: "report" });
  const resultPanel = element("div", { className: "panel" });
  resultPanel.append(resultList);
  const canvas = element("canvas", { className: "spectrum" });
  canvas.width = SPECTRUM_SIZE.width;
  canvas.height = SPECTRUM_SIZE.height;
  const player = element("audio");
  player.controls = true;
  resultsSection.append(
    element("h2", { text: "Recording" }),
    resultPanel,
    element("h2", { text: "Spectrum, 0 to 6 kHz" }),
    canvas,
    element("h2", { text: "Playback" }),
    player,
  );

  root.append(title, intro, button, status, processingSection, liveSection, resultsSection);
  return { button, status, processingSection, liveSection, levelFill, levelText, resultsSection, resultList, canvas, player };
}

function main(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const page = buildPage(root);
  let session: RecordingSession | null = null;
  let busy = false;
  let autoStop: AutoStop | null = null;
  let startedAtMs = 0;
  let playbackUrl: string | null = null;

  function setStatus(message: string, isError = false, detail?: string): void {
    const lines = [element("span", { text: message })];
    if (detail) lines.push(element("span", { className: "status-detail", text: detail }));
    page.status.replaceChildren(...lines);
    page.status.classList.toggle("error", isError);
  }

  function showLevel(levelDb: number): void {
    const fraction = Math.min(1, Math.max(0, (levelDb - LEVEL_BAR_MIN_DB) / -LEVEL_BAR_MIN_DB));
    page.levelFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    page.levelText.textContent = formatDb(levelDb);
  }

  function showProcessing(report: ProcessingReport): void {
    const verdict = processingVerdict(report);
    const section = page.processingSection;
    const list = element("dl", { className: "report" });
    addRow(list, "Echo cancellation", formatFlag(report.echoCancellation));
    addRow(list, "Noise suppression", formatFlag(report.noiseSuppression));
    addRow(list, "Auto gain control", formatFlag(report.autoGainControl));
    section.replaceChildren(
      element("h2", { text: "Voice processing" }),
      list,
      element("p", { text: verdict.text, className: verdict.good ? "verdict-good" : "verdict-bad" }),
    );
    section.hidden = false;
  }

  function showResult(result: RecordingResult): void {
    page.resultList.replaceChildren();
    addRow(page.resultList, "Sample rate", `${(result.sampleRate / 1000).toFixed(1)} kHz`);
    addRow(page.resultList, "Length", `${(result.durationMs / 1000).toFixed(2)} s`);
    addRow(page.resultList, "Peak level", formatDb(peakDb(result.pcm)));
    addRow(page.resultList, "Saved as", result.mimeType);
    drawSpectrum(page.canvas, result);
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = URL.createObjectURL(result.blob);
    page.player.src = playbackUrl;
    page.resultsSection.hidden = false;
  }

  async function begin(): Promise<void> {
    setStatus("Asking for the microphone...");
    page.resultsSection.hidden = true;
    page.player.pause();
    session = await startRecording();
    autoStop = new AutoStop();
    startedAtMs = performance.now();
    session.onLevel(handleLevel);
    showProcessing(session.processing);
    page.liveSection.hidden = false;
    page.button.textContent = "Stop";
    page.button.classList.add("recording");
    setStatus("Recording. Make your call, then press Stop. It also stops by itself after a pause.");
  }

  async function end(active: RecordingSession): Promise<void> {
    page.button.disabled = true;
    setStatus("Finishing up...");
    const result = await active.stop();
    session = null;
    page.liveSection.hidden = true;
    showProcessing(result.processing);
    showResult(result);
    page.button.textContent = "Record again";
    page.button.classList.remove("recording");
    setStatus("Done.");
  }

  function run(task: Promise<void>): void {
    busy = true;
    task
      .catch((error: unknown) => {
        session?.cancel();
        session = null;
        page.liveSection.hidden = true;
        page.button.textContent = "Record";
        page.button.classList.remove("recording");
        const { summary, detail } = describeCaptureError(error);
        setStatus(summary, true, detail);
      })
      .finally(() => {
        busy = false;
        page.button.disabled = false;
      });
  }

  function handleLevel(levelDb: number): void {
    showLevel(levelDb);
    const active = session;
    if (!active || busy || !autoStop) return;
    const elapsedS = (performance.now() - startedAtMs) / 1000;
    if (autoStop.update(levelDb, elapsedS)) run(end(active));
  }

  page.button.addEventListener("click", () => {
    if (busy) return;
    const active = session;
    run(active ? end(active) : begin());
  });

  window.addEventListener("pagehide", () => session?.cancel());
}

main();
