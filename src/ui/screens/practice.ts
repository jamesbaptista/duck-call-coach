import { AutoStop } from "../../capture/autostop";
import { startRecording, type RecordingResult, type RecordingSession } from "../../capture/recorder";
import { liveResonanceHz } from "../../analysis/noteFeatures";
import type { CallType } from "../../analysis/types";
import { loadTargets } from "../../scoring/score";
import type { AttemptRecord } from "../../storage/db";
import { chooseTargets } from "../attempt";
import { button, el } from "../dom";
import { CALL_NAMES, confidenceText } from "../labels";
import { navigate, routeHref } from "../router";
import {
  ANALYSIS_FAILED_TEXT,
  ANALYZING_TEXT,
  captureErrorMessage,
  errorDetail,
  renderStatus,
  SAVE_FAILED_TEXT,
  watchMicPermission,
  type StatusMessage,
} from "../messages";
import { analyzeToAttempt, retryAnalysis, saveOrRemember, type AnalyzedAttempt } from "../pipeline";
import { ClipPlayer, loadPracticeTarget } from "../target";
import { LiveView } from "./practice/live";
import type { Cleanup, RenderScreen } from "./screen";

type Phase = "idle" | "starting" | "recording" | "finishing" | "analyzing";

const RECORD_LABEL = "Record";
const STOP_LABEL = "Stop";
/**
 * The 15 s hard stop, enforced by a timer as well as by AutoStop: AutoStop is fed from animation frames, which
 * stop while the screen is off or the tab is hidden.
 */
const HARD_STOP_MS = 15_000;

/** The Practice screen: hear the target, record a call, then analyse, score, save and go to the results. */
class PracticeScreen {
  private phase: Phase = "idle";
  private session: RecordingSession | null = null;
  private autoStop = new AutoStop();
  private startedAtMs = 0;
  private createdAt = 0;
  private hardStopTimer: number | undefined;
  private disposed = false;
  /** The last attempt whose analysis failed, for Retry analysis. */
  private failedAttempt: AttemptRecord | null = null;
  private stopWatchingMic: Cleanup | null = null;

  private readonly confidence = el("p", { class: "confidence" });
  private readonly targetLabel = el("p", { class: "target-label" }, "Loading the target…");
  private readonly playButton = button("Play target", { class: "button secondary" });
  private readonly recordButton = button(RECORD_LABEL, { class: "button record-button" });
  private readonly live = new LiveView();
  private readonly status = el("div", { class: "status", role: "status", "aria-live": "polite" });
  private readonly retryButton = button("Retry analysis", { class: "button secondary" });
  private readonly resultsLink = el("a", { class: "button secondary" }, "See results");
  private readonly player = new ClipPlayer(this.playButton, (message) => this.show({ text: message, error: true }));
  private readonly onPageHide = (): void => this.abandonRecording();

  constructor(
    root: HTMLElement,
    private readonly callType: CallType,
  ) {
    const targets = loadTargets(callType);
    this.confidence.textContent = confidenceText(targets.confidence);
    this.retryButton.hidden = true;
    this.resultsLink.hidden = true;
    root.append(
      el("a", { class: "back-link", href: routeHref({ name: "home" }), "aria-label": "Back to Home" }, "‹ Home"),
      el("h1", { tabindex: "-1" }, CALL_NAMES[callType]),
      el("p", { class: "lead" }, targets.description),
      this.confidence,
      this.targetLabel,
      this.playButton,
      this.recordButton,
      this.live.root,
      this.status,
      el("div", { class: "actions" }, this.retryButton, this.resultsLink),
    );
    this.recordButton.addEventListener("click", () => this.onRecordClick());
    this.retryButton.addEventListener("click", () => this.onRetryClick());
    window.addEventListener("pagehide", this.onPageHide);
    void this.loadTarget();
  }

  readonly cleanup: Cleanup = () => {
    this.disposed = true;
    clearTimeout(this.hardStopTimer);
    // Discards a recording in progress; one already stopping is left to finish (cancel() ignores it) and is saved.
    this.session?.cancel();
    this.session = null;
    this.player.dispose();
    this.stopWatchingMic?.();
    window.removeEventListener("pagehide", this.onPageHide);
  };

  private async loadTarget(): Promise<void> {
    const { clip, reference } = await loadPracticeTarget(this.callType);
    if (this.disposed) {
      clip.release();
      return;
    }
    this.player.setClip(clip);
    this.player.setEnabled(this.phase === "idle");
    this.targetLabel.textContent = clip.label;
    this.confidence.textContent = confidenceText(chooseTargets(this.callType, reference, null).confidence);
  }

  private show(message: StatusMessage): void {
    renderStatus(this.status, message);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    const recording = phase === "recording";
    this.recordButton.textContent = recording ? STOP_LABEL : RECORD_LABEL;
    this.recordButton.classList.toggle("recording", recording);
    this.recordButton.disabled = !(phase === "idle" || recording);
    this.player.setEnabled(phase === "idle");
    if (phase !== "idle") {
      this.retryButton.hidden = true;
      this.resultsLink.hidden = true;
    }
  }

  private onRecordClick(): void {
    if (this.phase === "idle") void this.guard(this.begin());
    else if (this.phase === "recording") void this.guard(this.finish());
  }

  private onRetryClick(): void {
    const attempt = this.failedAttempt;
    if (attempt && this.phase === "idle") void this.guard(this.analyze(() => retryAnalysis(attempt)));
  }

  /** Never fail silently: anything unexpected ends up in the status region. */
  private async guard(task: Promise<void>): Promise<void> {
    try {
      await task;
    } catch (error) {
      if (this.disposed) return;
      clearTimeout(this.hardStopTimer);
      this.session?.cancel();
      this.session = null;
      this.live.hide();
      this.setPhase("idle");
      this.show({ text: "Something went wrong. Try again.", detail: errorDetail(error), error: true });
    }
  }

  private async begin(): Promise<void> {
    this.setPhase("starting");
    this.player.stop();
    this.stopWatchingMic?.();
    this.show({ text: "Asking for the microphone…" });
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
    this.createdAt = Date.now();
    session.onLevel((levelDb, freqDb, binHz) => this.onLevel(levelDb, freqDb, binHz));
    this.live.show();
    this.setPhase("recording");
    this.hardStopTimer = window.setTimeout(() => void this.guard(this.finish()), HARD_STOP_MS);
    this.show({ text: "Recording. Make your call. It stops by itself after a pause, or tap Stop." });
  }

  private showCaptureError(error: unknown): void {
    this.setPhase("idle");
    this.show(captureErrorMessage(error));
    if (error instanceof Error && error.name === "NotAllowedError") {
      // Record stays disabled until the browser reports the microphone is no longer blocked.
      this.recordButton.disabled = true;
      this.stopWatchingMic = watchMicPermission(() => {
        if (this.phase === "idle") this.recordButton.disabled = false;
      });
    }
  }

  private onLevel(levelDb: number, freqDb: Float32Array, binHz: number): void {
    if (this.phase !== "recording") return;
    const tS = (performance.now() - this.startedAtMs) / 1000;
    this.live.update(levelDb, tS, liveResonanceHz(freqDb, binHz));
    if (this.autoStop.update(levelDb, tS)) void this.guard(this.finish());
  }

  private async finish(): Promise<void> {
    const session = this.session;
    if (!session || this.phase !== "recording") return;
    clearTimeout(this.hardStopTimer);
    this.setPhase("finishing");
    this.show({ text: ANALYZING_TEXT });
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
    // A finished recording is analysed and saved even if the screen was left meanwhile (see analyze()).
    const identity = { id: crypto.randomUUID(), createdAt: this.createdAt };
    // The worker takes the samples; Retry analysis decodes the saved recording instead of keeping a copy.
    await this.analyze(() =>
      analyzeToAttempt(recording.pcm, recording.sampleRate, this.callType, recording, identity),
    );
  }

  /** Analyses and saves. After the screen is left it still saves, but no longer touches the detached DOM. */
  private async analyze(run: () => Promise<AnalyzedAttempt>): Promise<void> {
    if (!this.disposed) {
      this.setPhase("analyzing");
      this.show({ text: ANALYZING_TEXT });
    }
    const { attempt, failure } = await run();
    const outcome = await saveOrRemember(attempt);
    if (this.disposed) return;
    this.setPhase("idle");
    const saveNotes = outcome.saved ? [] : [SAVE_FAILED_TEXT];

    if (failure) {
      this.failedAttempt = attempt;
      this.retryButton.hidden = false;
      this.show({ text: ANALYSIS_FAILED_TEXT, notes: saveNotes, detail: errorDetail(failure.error), error: true });
      return;
    }
    this.failedAttempt = null;
    if (!outcome.saved) {
      this.resultsLink.setAttribute("href", routeHref({ name: "results", id: attempt.id }));
      this.resultsLink.hidden = false;
      this.show({ text: SAVE_FAILED_TEXT, detail: errorDetail(outcome.error), error: true });
      return;
    }
    navigate({ name: "results", id: attempt.id });
  }

  /** Leaving the page mid-recording throws the recording away rather than keeping the microphone open. */
  private abandonRecording(): void {
    if (this.phase !== "recording") return;
    clearTimeout(this.hardStopTimer);
    this.session?.cancel();
    this.session = null;
    this.live.hide();
    this.setPhase("idle");
    this.show({ text: "Recording stopped because you left the page. Tap Record to try again." });
  }
}

export const renderPractice: RenderScreen<{ callType: CallType }> = (root, route) =>
  new PracticeScreen(root, route.callType).cleanup;
