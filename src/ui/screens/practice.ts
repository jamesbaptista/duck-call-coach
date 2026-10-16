import type { RecordingResult } from "../../capture/recorder";
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
  errorDetail,
  renderStatus,
  SAVE_FAILED_TEXT,
  unexpectedErrorMessage,
  type StatusMessage,
} from "../messages";
import { analyzeToAttempt, retryAnalysis, saveOrRemember, type AnalyzedAttempt } from "../pipeline";
import { RecordingControl } from "../recordingControl";
import { ClipPlayer, loadPracticeTarget } from "../target";
import type { Cleanup, RenderScreen } from "./screen";

/** The Practice screen: hear the target, record a call, then analyze, score, save and go to the results. */
class PracticeScreen {
  private disposed = false;
  /** True while Retry analysis runs. */
  private retrying = false;
  /** The last attempt whose analysis failed, for Retry analysis. */
  private failedAttempt: AttemptRecord | null = null;

  private readonly confidence = el("p", { class: "confidence" });
  private readonly targetLabel = el("p", { class: "target-label" }, "Loading the target…");
  private readonly playButton = button("Play target", { class: "button secondary" });
  private readonly status = el("div", { class: "status", role: "status", "aria-live": "polite" });
  private readonly retryButton = button("Retry analysis", { class: "button secondary" });
  private readonly resultsLink = el("a", { class: "button secondary" }, "See results");
  private readonly player = new ClipPlayer(this.playButton, (message) => this.show({ text: message, error: true }));
  private readonly recorder = new RecordingControl({
    show: (message) => this.show(message),
    beforeStart: () => this.player.stop(),
    onPhaseChange: () => this.updateControls(),
    onRecorded: (recording, startedAt) => this.onRecorded(recording, startedAt),
  });

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
      this.recorder.button,
      this.recorder.live.root,
      this.status,
      el("div", { class: "actions" }, this.retryButton, this.resultsLink),
    );
    this.retryButton.addEventListener("click", () => this.onRetryClick());
    void this.loadTarget();
  }

  readonly cleanup: Cleanup = () => {
    this.disposed = true;
    this.recorder.dispose();
    this.player.dispose();
  };

  private async loadTarget(): Promise<void> {
    const { clip, reference } = await loadPracticeTarget(this.callType);
    if (this.disposed) {
      clip.release();
      return;
    }
    this.player.setClip(clip);
    this.updateControls();
    this.targetLabel.textContent = clip.label;
    this.confidence.textContent = confidenceText(chooseTargets(this.callType, reference, null).confidence);
  }

  private show(message: StatusMessage): void {
    renderStatus(this.status, message);
  }

  private isIdle(): boolean {
    return this.recorder.phase === "idle" && !this.retrying;
  }

  /** Target and Record only work when nothing else is going on; old Retry and See results links go once it is. */
  private updateControls(): void {
    const idle = this.isIdle();
    this.recorder.setEnabled(!this.retrying);
    this.player.setEnabled(idle);
    if (!idle) {
      this.retryButton.hidden = true;
      this.resultsLink.hidden = true;
    }
  }

  private onRetryClick(): void {
    const attempt = this.failedAttempt;
    if (attempt && this.isIdle()) void this.retry(attempt);
  }

  private async retry(attempt: AttemptRecord): Promise<void> {
    this.retrying = true;
    this.updateControls();
    this.show({ text: ANALYZING_TEXT });
    try {
      await this.analyze(() => retryAnalysis(attempt));
    } catch (error) {
      // Never fail silently: a bug in building the attempt still ends up in the status region.
      if (!this.disposed) this.show(unexpectedErrorMessage(error));
    } finally {
      this.retrying = false;
      if (!this.disposed) this.updateControls();
    }
  }

  /** A finished recording is analyzed and saved even if the screen was left meanwhile (see analyze()). */
  private onRecorded(recording: RecordingResult, startedAt: number): Promise<void> {
    const identity = { id: crypto.randomUUID(), createdAt: startedAt };
    // The worker takes the samples; Retry analysis decodes the saved recording instead of keeping a copy.
    return this.analyze(() => analyzeToAttempt(recording.pcm, recording.sampleRate, this.callType, recording, identity));
  }

  /** Analyzes and saves. After the screen is left it still saves, but no longer touches the detached DOM. */
  private async analyze(run: () => Promise<AnalyzedAttempt>): Promise<void> {
    const { attempt, failure } = await run();
    const outcome = await saveOrRemember(attempt);
    if (this.disposed) return;
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
}

export const renderPractice: RenderScreen<{ callType: CallType }> = (root, route) =>
  new PracticeScreen(root, route.callType).cleanup;
