import { liveResonanceHz } from "../analysis/noteFeatures";
import { AutoStop } from "../capture/autostop";
import { startRecording, type RecordingResult, type RecordingSession } from "../capture/recorder";
import { button } from "./dom";
import { MAX_RECORDING_S } from "./limits";
import { LiveView } from "./liveView";
import {
  ANALYZING_TEXT,
  captureErrorMessage,
  unexpectedErrorMessage,
  watchMicPermission,
  type StatusMessage,
} from "./messages";
import type { Cleanup } from "./screens/screen";

/**
 * The Record / Stop button and everything behind it, shared by Practice and References: asking for the microphone,
 * the live display, stopping after a pause or at 15 s, and handing the finished recording to the screen.
 */

export type RecordingPhase = "idle" | "starting" | "recording" | "finishing" | "processing";

const RECORD_LABEL = "Record";
const STOP_LABEL = "Stop";
/**
 * The hard stop, enforced by a timer as well as by AutoStop: AutoStop is fed from animation frames, which stop
 * while the screen is off or the tab is hidden.
 */
const HARD_STOP_MS = MAX_RECORDING_S * 1000;

export interface RecordingControlOptions {
  /** Shows a message in the screen's status region. */
  show(message: StatusMessage): void;
  /** Runs when Record is tapped, before the microphone is asked for: stop playback so the microphone doesn't hear it. */
  beforeStart(): void;
  /** Runs on every phase change, so the screen can enable or disable its other controls. */
  onPhaseChange(phase: RecordingPhase): void;
  /**
   * The recording stopped and its samples are ready; `startedAt` is when it began (epoch ms). Record stays disabled
   * ("processing") until the promise settles, and a rejection is shown as an unexpected error. It runs even if the
   * screen was left while the recording was stopping, so the screen decides what to do then.
   */
  onRecorded(recording: RecordingResult, startedAt: number): Promise<void>;
}

export class RecordingControl {
  readonly button = button(RECORD_LABEL, { class: "button record-button" });
  readonly live = new LiveView();

  private currentPhase: RecordingPhase = "idle";
  private session: RecordingSession | null = null;
  private autoStop = new AutoStop();
  private startedAtMs = 0;
  private startedAt = 0;
  private hardStopTimer: number | undefined;
  private disposed = false;
  /** False while the screen is busy with something else; see setEnabled. */
  private enabled = true;
  /** True after the microphone was blocked, until the browser reports it may work again. */
  private micBlocked = false;
  private stopWatchingMic: Cleanup | null = null;
  private readonly onPageHide = (): void => this.abandon();

  constructor(private readonly options: RecordingControlOptions) {
    this.button.addEventListener("click", () => this.onClick());
    window.addEventListener("pagehide", this.onPageHide);
  }

  get phase(): RecordingPhase {
    return this.currentPhase;
  }

  /** Keeps Record disabled while the screen does something else (analysing, importing, saving). Stop always works. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refreshButton();
  }

  /** Discards a recording in progress; one already stopping is left to finish (cancel() ignores it). */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.hardStopTimer);
    this.session?.cancel();
    this.session = null;
    this.stopWatchingMic?.();
    this.stopWatchingMic = null;
    window.removeEventListener("pagehide", this.onPageHide);
  }

  private setPhase(phase: RecordingPhase): void {
    this.currentPhase = phase;
    this.refreshButton();
    this.options.onPhaseChange(phase);
  }

  private refreshButton(): void {
    const recording = this.currentPhase === "recording";
    this.button.textContent = recording ? STOP_LABEL : RECORD_LABEL;
    this.button.classList.toggle("recording", recording);
    this.button.disabled = !(recording || this.canStart());
  }

  private canStart(): boolean {
    return this.currentPhase === "idle" && this.enabled && !this.micBlocked;
  }

  private onClick(): void {
    if (this.canStart()) void this.run(this.begin());
    else if (this.currentPhase === "recording") void this.run(this.finish());
  }

  /** Never fail silently: anything unexpected stops the recording and ends up in the status region. */
  private async run(task: Promise<void>): Promise<void> {
    try {
      await task;
    } catch (error) {
      if (this.disposed) return;
      clearTimeout(this.hardStopTimer);
      this.session?.cancel();
      this.session = null;
      this.live.hide();
      this.setPhase("idle");
      this.options.show(unexpectedErrorMessage(error));
    }
  }

  private async begin(): Promise<void> {
    this.setPhase("starting");
    this.options.beforeStart();
    this.options.show({ text: "Asking for the microphone…" });
    let session: RecordingSession;
    try {
      session = await startRecording();
    } catch (error) {
      if (!this.disposed) this.showCaptureError(error);
      return;
    }
    if (this.disposed) {
      session.cancel();
      return;
    }
    this.session = session;
    this.autoStop = new AutoStop();
    this.startedAtMs = performance.now();
    this.startedAt = Date.now();
    session.onLevel((levelDb, freqDb, binHz) => this.onLevel(levelDb, freqDb, binHz));
    this.live.show();
    this.setPhase("recording");
    this.hardStopTimer = window.setTimeout(() => void this.run(this.finish()), HARD_STOP_MS);
    this.options.show({ text: "Recording. Make your call. It stops by itself after a pause, or tap Stop." });
  }

  private showCaptureError(error: unknown): void {
    this.setPhase("idle");
    this.options.show(captureErrorMessage(error));
    if (error instanceof Error && error.name === "NotAllowedError") this.blockUntilMicAllowed();
  }

  /** Record stays disabled until the browser reports the microphone is no longer blocked. */
  private blockUntilMicAllowed(): void {
    this.stopWatchingMic?.();
    this.micBlocked = true;
    this.refreshButton();
    this.stopWatchingMic = watchMicPermission(() => {
      this.stopWatchingMic = null;
      this.micBlocked = false;
      this.refreshButton();
    });
  }

  private onLevel(levelDb: number, freqDb: Float32Array, binHz: number): void {
    if (this.currentPhase !== "recording") return;
    const tS = (performance.now() - this.startedAtMs) / 1000;
    this.live.update(levelDb, tS, liveResonanceHz(freqDb, binHz));
    if (this.autoStop.update(levelDb, tS)) void this.run(this.finish());
  }

  private async finish(): Promise<void> {
    const session = this.session;
    if (!session || this.currentPhase !== "recording") return;
    clearTimeout(this.hardStopTimer);
    this.setPhase("finishing");
    this.options.show({ text: ANALYZING_TEXT });
    let recording: RecordingResult;
    try {
      recording = await session.stop();
    } catch (error) {
      if (!this.disposed) this.showCaptureError(error);
      return;
    } finally {
      this.session = null;
      if (!this.disposed) this.live.hide();
    }
    if (!this.disposed) this.setPhase("processing");
    await this.options.onRecorded(recording, this.startedAt);
    if (!this.disposed) this.setPhase("idle");
  }

  /** Leaving the page mid-recording throws the recording away rather than keeping the microphone open. */
  private abandon(): void {
    if (this.currentPhase !== "recording") return;
    clearTimeout(this.hardStopTimer);
    this.session?.cancel();
    this.session = null;
    this.live.hide();
    this.setPhase("idle");
    this.options.show({ text: "Recording stopped because you left the page. Tap Record to try again." });
  }
}
