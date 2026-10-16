import type { AnalysisResult, CallMeasurements, CallType, Note } from "../../analysis/types";
import type { RecordingResult } from "../../capture/recorder";
import { getDefaultStore, type ReferenceMeta } from "../../storage/db";
import { callSwitcher } from "../callSwitcher";
import { decodeToMono, type DecodedAudio } from "../decode";
import { button, el } from "../dom";
import { checkImportFile } from "../importAudio";
import { CALL_NAMES } from "../labels";
import { ANALYZING_TEXT, clearStatus, errorDetail, renderStatus, unexpectedErrorMessage, type StatusMessage } from "../messages";
import { analyzeWithTimeout } from "../pipeline";
import { MAX_RECORDING_S, RecordingControl } from "../recordingControl";
import { routeHref } from "../router";
import { formatAttemptDate } from "./history/model";
import {
  activeTargetText,
  defaultReferenceName,
  deleteReferenceQuestion,
  nameFromFileName,
  normalizeReferenceName,
} from "./references/model";
import { PLAY_LABEL, ReferencePlayer } from "./references/player";
import { QUALITY_MESSAGES } from "./results/model";
import type { Cleanup, RenderScreen } from "./screen";

const INTRO =
  "A reference is a call you pick as your target. While one is active, your attempts at this call are scored " +
  "against it instead of the built-in target.";
const ADD_INTRO = `Record a call you like, or import an audio file from your phone. Up to ${MAX_RECORDING_S} seconds are used.`;
const LOAD_FAILED_TEXT = "Your references couldn't be loaded.";
const UNCHANGED_TEXT = "Your current target hasn't changed.";
const READING_TEXT = "Reading the file…";
const DECODE_FAILED_TEXT = "We couldn't read that audio file.";
const CROPPED_TEXT = `Only the first ${MAX_RECORDING_S} seconds were used.`;
const NOT_USABLE_TEXT = "This can't be used as a reference.";
const ANALYSIS_FAILED_TEXT = "The analysis didn't finish. Record or import the call again.";
const NAME_REQUIRED_TEXT = "Give the reference a name.";
const SAVING_TEXT = "Saving…";
const SAVE_FAILED_TEXT =
  "Couldn't save this reference. Your phone may be out of space: back up and delete old attempts on the History " +
  "screen, then tap Save reference again.";
const CHANGE_FAILED_TEXT = "Couldn't change the target. Try again.";
const DELETE_FAILED_TEXT = "Couldn't delete that reference. Try again.";

/** A recording or file that was analysed and can be saved as a reference once it has a name. */
interface Candidate {
  audio: Blob;
  mimeType: string;
  createdAt: number;
  measurements: CallMeasurements;
  notes: Note[];
}

/** Samples to analyse, plus what the reference keeps if they turn out usable. */
interface CandidateSource {
  pcm: Float32Array;
  sampleRate: number;
  audio: Blob;
  mimeType: string;
  createdAt: number;
  suggestedName: string;
  /** Said alongside the outcome, for example that a long file was cut. */
  notes: string[];
}

function statusRegion(): HTMLElement {
  return el("div", { class: "status", role: "status", "aria-live": "polite" });
}

/** The References screen for one call: the saved references, which one is the target, and adding new ones. */
class ReferencesScreen {
  private disposed = false;
  /** True while an import, a save or a change to the list runs; one at a time. */
  private busy = false;
  /** Only the newest load may draw, so a slow earlier one can't overwrite a refresh. */
  private loadCount = 0;
  private candidate: Candidate | null = null;
  /** The buttons in the list rows, enabled and disabled together. */
  private rowButtons: HTMLButtonElement[] = [];

  private readonly callName: string;
  private readonly dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  private readonly dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  private readonly activeText = el("p", { class: "active-target" }, "Loading…");
  private readonly listBody = el("div", {}, el("p", {}, "Loading your references…"));
  private readonly builtInButton = button("Use the built-in target", { class: "button secondary", hidden: "" });
  private readonly listStatus = statusRegion();
  private readonly addStatus = statusRegion();
  private readonly fileInput = el("input", { type: "file", accept: "audio/*", class: "file-input" }) as HTMLInputElement;
  private readonly nameInput = el("input", {
    type: "text",
    id: "reference-name",
    class: "text-input",
    maxlength: "60",
    autocomplete: "off",
    enterkeyhint: "done",
  }) as HTMLInputElement;
  private readonly saveButton = button("Save reference", { class: "button primary", type: "submit" });
  private readonly discardButton = button("Discard", { class: "button secondary" });
  private readonly nameForm: HTMLElement;
  private readonly player = new ReferencePlayer((message) => this.showList({ text: message, error: true }));
  private readonly recorder = new RecordingControl({
    show: (message) => this.showAdd(message),
    beforeStart: () => this.beforeRecording(),
    onPhaseChange: () => this.updateControls(),
    onRecorded: (recording, startedAt) => this.onRecorded(recording, startedAt),
  });

  constructor(
    root: HTMLElement,
    private readonly callType: CallType,
  ) {
    this.callName = CALL_NAMES[callType];
    this.nameForm = el(
      "form",
      { class: "name-form", hidden: "" },
      el("label", { for: "reference-name" }, "Name this reference"),
      this.nameInput,
      this.saveButton,
      this.discardButton,
    );
    root.append(
      el("a", { class: "back-link", href: routeHref({ name: "home" }), "aria-label": "Back to Home" }, "‹ Home"),
      el("h1", { tabindex: "-1" }, "References"),
      el("p", { class: "lead" }, INTRO),
      callSwitcher("references", callType),
      el(
        "section",
        {},
        el("h2", {}, `${this.callName} references`),
        this.activeText,
        this.listBody,
        this.builtInButton,
        this.listStatus,
      ),
      el(
        "section",
        {},
        el("h2", {}, "Add a reference"),
        el("p", {}, ADD_INTRO),
        this.recorder.button,
        this.recorder.live.root,
        el("label", { class: "button secondary file-button" }, "Import an audio file", this.fileInput),
        this.nameForm,
        this.addStatus,
      ),
    );
    this.fileInput.addEventListener("change", () => void this.onFileChosen());
    this.nameForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveCandidate();
    });
    this.discardButton.addEventListener("click", () => {
      this.discardCandidate();
      clearStatus(this.addStatus);
    });
    this.builtInButton.addEventListener("click", () => void this.useBuiltIn());
    void this.loadReferences();
  }

  readonly cleanup: Cleanup = () => {
    this.disposed = true;
    this.recorder.dispose();
    this.player.reset();
  };

  private showList(message: StatusMessage): void {
    renderStatus(this.listStatus, message);
  }

  private showAdd(message: StatusMessage): void {
    renderStatus(this.addStatus, message);
  }

  /** Everything but Stop waits while a recording, an analysis, an import, a save or a list change runs. */
  private updateControls(): void {
    const idle = !this.busy && this.recorder.phase === "idle";
    this.recorder.setEnabled(!this.busy);
    this.fileInput.disabled = !idle;
    for (const control of [...this.rowButtons, this.builtInButton, this.saveButton, this.discardButton]) {
      control.disabled = !idle;
    }
    this.nameInput.disabled = !idle;
  }

  /** Runs one action at a time with the controls disabled; anything unexpected is shown in `region`. */
  private async runBusy(region: HTMLElement, action: () => Promise<void>): Promise<void> {
    if (this.busy || this.recorder.phase !== "idle") return;
    this.busy = true;
    this.updateControls();
    try {
      await action();
    } catch (error) {
      if (!this.disposed) renderStatus(region, unexpectedErrorMessage(error));
    } finally {
      this.busy = false;
      if (!this.disposed) this.updateControls();
    }
  }

  // The list

  private async loadReferences(): Promise<void> {
    const load = ++this.loadCount;
    const current = (): boolean => !this.disposed && load === this.loadCount;
    try {
      const references = await (await getDefaultStore()).listReferences(this.callType);
      if (current()) this.showReferences(references);
    } catch (error) {
      if (!current()) return;
      this.player.reset();
      this.rowButtons = [];
      this.activeText.textContent = "";
      this.builtInButton.hidden = true;
      this.listBody.replaceChildren(el("p", {}, LOAD_FAILED_TEXT), el("p", { class: "status-detail" }, errorDetail(error)));
    }
  }

  /** `references` are newest first, as listReferences returns them. */
  private showReferences(references: ReferenceMeta[]): void {
    this.player.reset();
    this.rowButtons = [];
    this.activeText.textContent = activeTargetText(references);
    this.builtInButton.hidden = !references.some((reference) => reference.active);
    if (references.length === 0) {
      this.listBody.replaceChildren(el("p", {}, `You have no ${this.callName} references yet.`));
    } else {
      this.listBody.replaceChildren(el("ul", { class: "reference-list" }, ...references.map((r) => this.row(r))));
    }
    this.updateControls();
  }

  private row(reference: ReferenceMeta): HTMLElement {
    const info = el(
      "div",
      { class: "reference-info" },
      el("span", { class: "reference-name" }, reference.name),
      el("span", { class: "reference-date" }, formatAttemptDate(reference.createdAt, this.dateFormat)),
    );
    if (reference.active) info.append(el("span", { class: "active-badge" }, "Active"));

    const play = button(PLAY_LABEL, { class: "button secondary" });
    play.addEventListener("click", () => void this.player.toggle(reference.id, play));
    const actions = [play];
    if (!reference.active) {
      const setActive = button("Set active", { class: "button primary" });
      setActive.addEventListener("click", () => void this.setActive(reference));
      actions.push(setActive);
    }
    const remove = button("Delete", { class: "button danger" });
    remove.addEventListener("click", () => void this.deleteReference(reference));
    actions.push(remove);
    this.rowButtons.push(...actions);

    return el("li", { class: "reference-row" }, info, el("div", { class: "reference-actions" }, ...actions));
  }

  private setActive(reference: ReferenceMeta): Promise<void> {
    return this.changeTarget(reference.id, `Your ${this.callName} attempts are now scored against “${reference.name}”.`);
  }

  private useBuiltIn(): Promise<void> {
    return this.changeTarget(null, `Your ${this.callName} attempts are now scored against the built-in target.`);
  }

  private changeTarget(id: string | null, doneText: string): Promise<void> {
    return this.runBusy(this.listStatus, async () => {
      clearStatus(this.listStatus);
      try {
        await (await getDefaultStore()).setActiveReference(this.callType, id);
      } catch (error) {
        if (!this.disposed) this.showList({ text: CHANGE_FAILED_TEXT, detail: errorDetail(error), error: true });
        return;
      }
      if (this.disposed) return;
      this.showList({ text: doneText });
      await this.loadReferences();
    });
  }

  private deleteReference(reference: ReferenceMeta): Promise<void> {
    return this.runBusy(this.listStatus, async () => {
      if (!window.confirm(deleteReferenceQuestion(reference.name))) return;
      clearStatus(this.listStatus);
      try {
        await (await getDefaultStore()).deleteReference(reference.id);
      } catch (error) {
        if (!this.disposed) this.showList({ text: DELETE_FAILED_TEXT, detail: errorDetail(error), error: true });
        return;
      }
      if (this.disposed) return;
      const notes = reference.active ? [`Your ${this.callName} attempts are scored against the built-in target again.`] : [];
      this.showList({ text: `“${reference.name}” was deleted.`, notes });
      await this.loadReferences();
    });
  }

  // Adding a reference

  private beforeRecording(): void {
    this.player.stop();
    this.discardCandidate();
  }

  /** A recording made here is only kept once it is named, so after leaving the screen it is dropped. */
  private async onRecorded(recording: RecordingResult, startedAt: number): Promise<void> {
    if (this.disposed) return;
    await this.analyzeCandidate({
      pcm: recording.pcm,
      sampleRate: recording.sampleRate,
      audio: recording.blob,
      mimeType: recording.mimeType,
      createdAt: startedAt,
      suggestedName: defaultReferenceName(startedAt, this.dayFormat),
      notes: [],
    });
  }

  private async onFileChosen(): Promise<void> {
    const file = this.fileInput.files?.[0];
    // Clear the choice so picking the same file again still fires "change".
    this.fileInput.value = "";
    if (file === undefined) return;
    await this.runBusy(this.addStatus, () => this.importFile(file));
  }

  /** Checks the file before reading it, decodes and analyses its first 15 s; a bad file leaves the target as it was. */
  private async importFile(file: File): Promise<void> {
    this.player.stop();
    this.discardCandidate();
    const problem = checkImportFile(file);
    if (problem !== null) {
      this.showAdd({ text: problem, notes: [UNCHANGED_TEXT], error: true });
      return;
    }
    this.showAdd({ text: READING_TEXT });
    let decoded: DecodedAudio;
    try {
      decoded = await decodeToMono(file, MAX_RECORDING_S);
    } catch (error) {
      if (!this.disposed) this.showAdd({ text: DECODE_FAILED_TEXT, notes: [UNCHANGED_TEXT], detail: errorDetail(error), error: true });
      return;
    }
    if (this.disposed) return;
    const createdAt = Date.now();
    await this.analyzeCandidate({
      pcm: decoded.pcm,
      sampleRate: decoded.sampleRate,
      audio: file,
      // checkImportFile accepted the type, so a backup will restore it.
      mimeType: file.type,
      createdAt,
      suggestedName: nameFromFileName(file.name) || defaultReferenceName(createdAt, this.dayFormat),
      notes: decoded.truncated ? [CROPPED_TEXT] : [],
    });
  }

  /** Analyses the samples (they go to the worker); a usable call becomes the candidate and the name form opens. */
  private async analyzeCandidate(source: CandidateSource): Promise<void> {
    this.showAdd({ text: ANALYZING_TEXT, notes: source.notes });
    let analysis: AnalysisResult;
    try {
      analysis = await analyzeWithTimeout(source.pcm, source.sampleRate, this.callType);
    } catch (error) {
      if (!this.disposed) {
        this.showAdd({ text: ANALYSIS_FAILED_TEXT, notes: [UNCHANGED_TEXT], detail: errorDetail(error), error: true });
      }
      return;
    }
    if (this.disposed) return;
    const { measurements, quality, notes } = analysis;
    if (quality !== null || measurements === null) {
      const reason = QUALITY_MESSAGES[quality ?? "no_notes"];
      this.showAdd({ text: NOT_USABLE_TEXT, notes: [reason, ...source.notes, UNCHANGED_TEXT], error: true });
      return;
    }
    this.candidate = { audio: source.audio, mimeType: source.mimeType, createdAt: source.createdAt, measurements, notes };
    this.nameInput.value = source.suggestedName;
    this.nameForm.hidden = false;
    const heard = `Heard ${notes.length} ${notes.length === 1 ? "note" : "notes"}. Name this reference, then tap Save reference.`;
    this.showAdd({ text: heard, notes: source.notes });
  }

  private discardCandidate(): void {
    this.candidate = null;
    this.nameForm.hidden = true;
    this.nameInput.value = "";
  }

  /** Saves the named candidate as the active reference; if that fails it is kept, so Save can be tapped again. */
  private async saveCandidate(): Promise<void> {
    const candidate = this.candidate;
    if (candidate === null) return;
    const name = normalizeReferenceName(this.nameInput.value);
    if (name === null) {
      this.showAdd({ text: NAME_REQUIRED_TEXT, error: true });
      this.nameInput.focus();
      return;
    }
    await this.runBusy(this.addStatus, async () => {
      this.showAdd({ text: SAVING_TEXT });
      try {
        // saveReference makes it the only active reference of this call.
        await (await getDefaultStore()).saveReference({
          id: crypto.randomUUID(),
          callType: this.callType,
          name,
          createdAt: candidate.createdAt,
          audio: candidate.audio,
          mimeType: candidate.mimeType,
          measurements: candidate.measurements,
          notes: candidate.notes,
          active: true,
        });
      } catch (error) {
        if (!this.disposed) this.showAdd({ text: SAVE_FAILED_TEXT, detail: errorDetail(error), error: true });
        return;
      }
      if (this.disposed) return;
      this.discardCandidate();
      this.showAdd({ text: `Saved “${name}”. Your ${this.callName} attempts are now scored against it.` });
      clearStatus(this.listStatus);
      await this.loadReferences();
    });
  }
}

export const renderReferences: RenderScreen<{ callType: CallType }> = (root, route) =>
  new ReferencesScreen(root, route.callType).cleanup;
