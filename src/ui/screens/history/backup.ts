import { BackupError, exportBackup, importBackup, isBackupFileTooBig, parseBackup } from "../../../storage/backup";
import { getDefaultStore } from "../../../storage/db";
import { backupFileName } from "../../backupFile";
import { button, el } from "../../dom";
import { clearStatus, errorDetail, renderStatus, type StatusMessage } from "../../messages";
import { restoreResultText } from "./model";

/**
 * The History screen's Back up / Restore and Delete everything controls. They act on every call type, so they
 * don't depend on the route. `onChanged` runs after anything on the phone was added or removed.
 */

const CONFIRM_WORD = "DELETE";
const PREPARING_TEXT = "Preparing backup…";
const RESTORING_TEXT = "Restoring…";
const DELETING_TEXT = "Deleting…";
const TOO_BIG_TEXT = "That file is too big to be a Duck Call Coach backup.";
const RESTORE_FAILED_TEXT = "Couldn't restore that file.";
const BACKUP_FAILED_TEXT = "Couldn't make a backup.";
const DELETE_FAILED_TEXT = "Couldn't delete everything. Try again.";
const DELETED_TEXT = "Everything was deleted. Your settings are kept.";
const BACKUP_INTRO =
  "A backup is one file with all your attempts, recordings and references. Keep it somewhere off this phone.";
const DELETE_INTRO =
  "This removes every attempt, recording and reference for all four calls. Your settings are kept. " +
  "Back up first if you might want them back.";

export interface DataSectionOptions {
  onChanged: () => void;
  isDisposed: () => boolean;
}

/**
 * How long a backup's object URL is kept after its download starts. Revoking it at once can abort the download on
 * mobile browsers; leaving the screen revokes it sooner.
 */
const DOWNLOAD_URL_LIFETIME_MS = 60_000;

function failure(text: string, error: unknown): StatusMessage {
  if (error instanceof BackupError) return { text: error.message, error: true };
  return { text, detail: errorDetail(error), error: true };
}

export class DataSection {
  readonly element: HTMLElement;

  private readonly backupButton = button("Back up", { class: "button primary" });
  private readonly fileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    class: "file-input",
  }) as HTMLInputElement;
  private readonly confirmInput = el("input", {
    type: "text",
    id: "delete-everything-confirm",
    class: "text-input",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
  }) as HTMLInputElement;
  private readonly deleteButton = button("Delete everything", { class: "button danger" });
  private readonly backupStatus = el("div", { class: "status", role: "status", "aria-live": "polite" });
  private readonly deleteStatus = el("div", { class: "status", role: "status", "aria-live": "polite" });
  private busy = false;
  /** Object URLs of backups handed to the browser, each with the timer that revokes it. */
  private readonly downloadUrls = new Map<string, number>();

  constructor(private readonly options: DataSectionOptions) {
    this.element = el("div", { class: "data-section" }, this.backupView(), this.deleteView());
    this.backupButton.addEventListener("click", () => {
      void this.run(() => this.backUp(), BACKUP_FAILED_TEXT, this.backupStatus);
    });
    this.fileInput.addEventListener("change", () => {
      void this.run(() => this.restore(), RESTORE_FAILED_TEXT, this.backupStatus);
    });
    this.confirmInput.addEventListener("input", () => this.updateControls());
    this.deleteButton.addEventListener("click", () => {
      void this.run(() => this.deleteEverything(), DELETE_FAILED_TEXT, this.deleteStatus);
    });
    this.updateControls();
  }

  /** Revokes every backup URL still held; History calls this when the screen is left. */
  dispose(): void {
    for (const [url, timer] of this.downloadUrls) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.downloadUrls.clear();
  }

  /** Hands the file to the browser's download. Its URL is revoked after a minute, or sooner if the screen is left. */
  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: fileName, hidden: "" });
    document.body.append(link);
    link.click();
    link.remove();
    const timer = window.setTimeout(() => {
      this.downloadUrls.delete(url);
      URL.revokeObjectURL(url);
    }, DOWNLOAD_URL_LIFETIME_MS);
    this.downloadUrls.set(url, timer);
  }

  private backupView(): HTMLElement {
    return el(
      "section",
      { "aria-labelledby": "backup-heading" },
      el("h2", { id: "backup-heading" }, "Back up and restore"),
      el("p", {}, BACKUP_INTRO),
      this.backupButton,
      el("label", { class: "button secondary file-button" }, "Restore from a backup file", this.fileInput),
      el("p", { class: "hint" }, "Restoring adds what's in the file and skips anything already on this phone."),
      this.backupStatus,
    );
  }

  private deleteView(): HTMLElement {
    return el(
      "section",
      { "aria-labelledby": "delete-everything-heading" },
      el("h2", { id: "delete-everything-heading" }, "Delete everything"),
      el("p", {}, DELETE_INTRO),
      el("label", { for: "delete-everything-confirm" }, `Type ${CONFIRM_WORD} to confirm`),
      this.confirmInput,
      this.deleteButton,
      this.deleteStatus,
    );
  }

  private updateControls(): void {
    this.backupButton.disabled = this.busy;
    this.fileInput.disabled = this.busy;
    this.confirmInput.disabled = this.busy;
    this.deleteButton.disabled = this.busy || this.confirmInput.value !== CONFIRM_WORD;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.updateControls();
  }

  /** One action at a time, with the controls disabled while it runs; anything unexpected is shown, never swallowed. */
  private async run(action: () => Promise<void>, failedText: string, region: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    // A new action makes the messages about earlier ones out of date.
    clearStatus(this.backupStatus);
    clearStatus(this.deleteStatus);
    try {
      await action();
    } catch (error) {
      if (!this.options.isDisposed()) renderStatus(region, failure(failedText, error));
    } finally {
      if (!this.options.isDisposed()) this.setBusy(false);
    }
  }

  private async backUp(): Promise<void> {
    renderStatus(this.backupStatus, { text: PREPARING_TEXT });
    const blob = await exportBackup(await getDefaultStore());
    if (this.options.isDisposed()) return;
    const fileName = backupFileName(new Date());
    this.download(blob, fileName);
    renderStatus(this.backupStatus, {
      text: `Your backup is downloading as ${fileName}. Keep a copy somewhere off this phone.`,
    });
  }

  private async restore(): Promise<void> {
    const file = this.fileInput.files?.[0];
    // Clear the choice so picking the same file again still fires "change".
    this.fileInput.value = "";
    if (file === undefined) return;
    if (isBackupFileTooBig(file.size)) {
      renderStatus(this.backupStatus, { text: TOO_BIG_TEXT, error: true });
      return;
    }
    renderStatus(this.backupStatus, { text: RESTORING_TEXT });
    const data = parseBackup(await file.text());
    const result = await importBackup(await getDefaultStore(), data);
    if (this.options.isDisposed()) return;
    renderStatus(this.backupStatus, { text: restoreResultText(result) });
    this.options.onChanged();
  }

  private async deleteEverything(): Promise<void> {
    if (this.confirmInput.value !== CONFIRM_WORD) return;
    renderStatus(this.deleteStatus, { text: DELETING_TEXT });
    await (await getDefaultStore()).deleteAll();
    if (this.options.isDisposed()) return;
    this.confirmInput.value = "";
    renderStatus(this.deleteStatus, { text: DELETED_TEXT });
    this.options.onChanged();
  }
}
