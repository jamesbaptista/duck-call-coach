import { getDefaultStore, type AttemptRecord, type ReferenceRecord } from "../../storage/db";
import { isAnalysisFailed } from "../attempt";
import { button, el } from "../dom";
import { CALL_NAMES } from "../labels";
import { navigate, routeHref } from "../router";
import { forgetUnsavedAttempt, getUnsavedAttempt } from "../session";
import {
  ANALYSIS_FAILED_TEXT,
  ANALYZING_TEXT,
  errorDetail,
  renderStatus,
  SAVE_FAILED_TEXT,
  type StatusMessage,
} from "../messages";
import { retryAnalysis, saveOrRemember } from "../pipeline";
import { ClipPlayer, loadActiveReference, targetClip, type PlayerLabels, type TargetClip } from "../target";
import {
  ANALYSIS_UNFINISHED_TEXT,
  chartTarget,
  NOT_FOUND_TEXT,
  PROCESSING_ON_NOTE,
  REFERENCE_INACTIVE_NOTE,
  resultsConfidence,
} from "./results/model";
import { chartView, notices, qualityView, scoresView, tipsView } from "./results/view";
import type { Cleanup, RenderScreen } from "./screen";

const MINE_LABELS: PlayerLabels = { play: "Play mine", stop: "Stop mine", failed: "Your recording couldn't be played" };
const AUDIO_MISSING_NOTE = "Your recording of this attempt is missing, so it can't be played or analysed again.";
const DELETE_QUESTION = "Delete this attempt? Its recording and score can't be brought back.";

/** Where the attempt came from: storage, or this page load's memory when saving failed. */
interface SaveState {
  /** A copy is in storage (so Delete must remove it there). */
  inStore: boolean;
  /** The version on screen is the one in storage. */
  current: boolean;
}

type Loaded = { attempt: AttemptRecord; save: SaveState } | { attempt: undefined; error: unknown };

/** Storage first, then attempts kept in memory because they couldn't be saved. */
async function loadAttempt(id: string): Promise<Loaded> {
  let error: unknown = null;
  try {
    const stored = await (await getDefaultStore()).getAttempt(id);
    if (stored) return { attempt: stored, save: { inStore: true, current: true } };
  } catch (caught) {
    error = caught;
  }
  const unsaved = getUnsavedAttempt(id);
  return unsaved ? { attempt: unsaved, save: { inStore: false, current: false } } : { attempt: undefined, error };
}

/** The recording as a playable clip, or null when its audio is gone. */
function recordingClip(attempt: AttemptRecord): TargetClip | null {
  if (attempt.audioMissing || attempt.audio.size === 0) return null;
  const url = URL.createObjectURL(attempt.audio);
  return { url, label: "", release: () => URL.revokeObjectURL(url) };
}

function recordedText(createdAt: number): string {
  const when = new Date(createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `Recorded ${when}`;
}

/** The Results screen: scores, the notes chart and tips for one attempt, or why it couldn't be judged. */
class ResultsScreen {
  private disposed = false;
  /** Undoes the current view: players and the recording's object URL. */
  private releaseView: Cleanup[] = [];
  private busyButtons: HTMLButtonElement[] = [];

  private readonly heading = el("h1", { tabindex: "-1" }, "Results");
  private readonly body = el("div", { class: "results" }, el("p", {}, "Loading your attempt…"));
  private readonly status = el("div", { class: "status", role: "status", "aria-live": "polite" });

  constructor(
    root: HTMLElement,
    private readonly id: string,
  ) {
    root.append(
      el("a", { class: "back-link", href: routeHref({ name: "home" }), "aria-label": "Back to Home" }, "‹ Home"),
      this.heading,
      this.body,
      this.status,
    );
    void this.guard(this.load());
  }

  readonly cleanup: Cleanup = () => {
    this.disposed = true;
    this.clearView();
  };

  private clearView(): void {
    for (const release of this.releaseView) release();
    this.releaseView = [];
    this.busyButtons = [];
  }

  private show(message: StatusMessage): void {
    renderStatus(this.status, message);
  }

  /** Never fail silently: anything unexpected ends up in the status region. */
  private async guard(task: Promise<void>): Promise<void> {
    try {
      await task;
    } catch (error) {
      if (this.disposed) return;
      this.setBusy(false);
      this.show({ text: "Something went wrong. Try again.", detail: errorDetail(error), error: true });
    }
  }

  private setBusy(busy: boolean): void {
    for (const control of this.busyButtons) control.disabled = busy;
  }

  private async load(): Promise<void> {
    const loaded = await loadAttempt(this.id);
    if (this.disposed) return;
    if (loaded.attempt === undefined) {
      this.showNotFound(loaded.error);
      return;
    }
    await this.showAttempt(loaded.attempt, loaded.save);
  }

  private showNotFound(error: unknown): void {
    this.body.replaceChildren(
      el("p", { class: "lead" }, NOT_FOUND_TEXT),
      el("a", { class: "button secondary", href: routeHref({ name: "home" }) }, "Go to Home"),
    );
    if (error !== null) this.show({ text: "Your saved attempts couldn't be read.", detail: errorDetail(error), error: true });
  }

  private async showAttempt(attempt: AttemptRecord, save: SaveState): Promise<void> {
    const reference =
      attempt.targetSource === "reference" && !isAnalysisFailed(attempt)
        ? await loadActiveReference(attempt.callType)
        : undefined;
    if (this.disposed) return;
    this.clearView();
    this.status.replaceChildren();
    this.status.classList.remove("error");
    this.heading.textContent = `${CALL_NAMES[attempt.callType]} results`;

    const intro = [el("p", { class: "recorded" }, recordedText(attempt.createdAt))];
    if (!save.current) intro.push(...notices([SAVE_FAILED_TEXT]));
    const view = isAnalysisFailed(attempt)
      ? this.failedView(attempt, save)
      : this.judgedView(attempt, save, reference);
    this.body.replaceChildren(...intro, ...view);
  }

  /** The Play mine player and button, and whether the recording exists to play. */
  private minePlayer(attempt: AttemptRecord): { mine: ClipPlayer; mineButton: HTMLButtonElement; hasAudio: boolean } {
    const mineButton = button(MINE_LABELS.play, { class: "button secondary" });
    const mine = new ClipPlayer(mineButton, (message) => this.show({ text: message, error: true }), MINE_LABELS);
    const clip = recordingClip(attempt);
    if (clip) mine.setClip(clip);
    this.releaseView.push(() => mine.dispose());
    return { mine, mineButton, hasAudio: clip !== null };
  }

  private deleteButton(attempt: AttemptRecord, save: SaveState): HTMLButtonElement {
    const control = button("Delete", { class: "button danger" });
    control.addEventListener("click", () => void this.guard(this.delete(attempt, save)));
    this.busyButtons.push(control);
    return control;
  }

  private failedView(attempt: AttemptRecord, save: SaveState): HTMLElement[] {
    const { mineButton, hasAudio } = this.minePlayer(attempt);
    const retry = button("Retry analysis", { class: "button primary" });
    const parts = [el("p", { class: "lead" }, ANALYSIS_UNFINISHED_TEXT)];
    if (hasAudio) {
      retry.addEventListener("click", () => void this.guard(this.retry(attempt, save)));
      this.busyButtons.push(retry);
    } else {
      retry.disabled = true;
      parts.push(...notices([AUDIO_MISSING_NOTE]));
    }
    return [...parts, el("div", { class: "actions" }, mineButton, retry, this.deleteButton(attempt, save))];
  }

  /** The score (or why there is none), the chart and tips, then the buttons. */
  private judgedView(
    attempt: AttemptRecord,
    save: SaveState,
    reference: ReferenceRecord | undefined,
  ): HTMLElement[] {
    const { quality } = attempt.analysis;
    const scores = quality === null ? attempt.scores : null;
    const target = chartTarget(attempt, reference);
    const parts: HTMLElement[] = [];
    if (quality !== null) parts.push(qualityView(quality));
    if (scores !== null) {
      if (target.referenceInactive) parts.push(...notices([REFERENCE_INACTIVE_NOTE]));
      parts.push(scoresView(scores, resultsConfidence(attempt, reference)));
    }
    if (!attempt.processingOff) parts.push(...notices([PROCESSING_ON_NOTE]));
    if (scores !== null) {
      parts.push(chartView(attempt.analysis.notes, target));
      const tips = tipsView(attempt.tips);
      if (tips) parts.push(tips);
    }
    return [...parts, ...this.judgedActions(attempt, save, reference)];
  }

  private judgedActions(
    attempt: AttemptRecord,
    save: SaveState,
    reference: ReferenceRecord | undefined,
  ): HTMLElement[] {
    const { mine, mineButton, hasAudio } = this.minePlayer(attempt);
    const targetButton = button("Play target", { class: "button secondary" });
    const target = new ClipPlayer(targetButton, (message) => this.show({ text: message, error: true }));
    const clip = targetClip(attempt.callType, reference);
    target.setClip(clip);
    this.releaseView.push(() => target.dispose());
    // One sound at a time: starting either player stops the other.
    mineButton.addEventListener("click", () => target.stop());
    targetButton.addEventListener("click", () => mine.stop());

    const parts: HTMLElement[] = [];
    if (!hasAudio) parts.push(...notices([AUDIO_MISSING_NOTE]));
    parts.push(
      el("p", { class: "target-label" }, clip.label),
      el(
        "div",
        { class: "actions" },
        mineButton,
        targetButton,
        el("a", { class: "button primary", href: routeHref({ name: "practice", callType: attempt.callType }) }, "Try again"),
        this.deleteButton(attempt, save),
      ),
    );
    return parts;
  }

  /** Analyses the saved recording again; on success the attempt (same id) is replaced and shown. */
  private async retry(attempt: AttemptRecord, save: SaveState): Promise<void> {
    this.setBusy(true);
    this.show({ text: ANALYZING_TEXT });
    const { attempt: next, failure } = await retryAnalysis(attempt);
    const outcome = await saveOrRemember(next);
    if (this.disposed) return;
    await this.showAttempt(next, { inStore: save.inStore || outcome.saved, current: outcome.saved });
    if (failure && !this.disposed) {
      this.show({ text: ANALYSIS_FAILED_TEXT, detail: errorDetail(failure.error), error: true });
    }
  }

  private async delete(attempt: AttemptRecord, save: SaveState): Promise<void> {
    if (!window.confirm(DELETE_QUESTION)) return;
    this.setBusy(true);
    if (save.inStore) {
      try {
        await (await getDefaultStore()).deleteAttempt(attempt.id);
      } catch (error) {
        if (this.disposed) return;
        this.setBusy(false);
        this.show({ text: "Couldn't delete this attempt. Try again.", detail: errorDetail(error), error: true });
        return;
      }
    }
    forgetUnsavedAttempt(attempt.id);
    if (!this.disposed) navigate({ name: "home" });
  }
}

export const renderResults: RenderScreen<{ id: string }> = (root, route) => new ResultsScreen(root, route.id).cleanup;
