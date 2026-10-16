import type { CallType } from "../../analysis/types";
import { getDefaultStore, storageEstimate, type AttemptMeta } from "../../storage/db";
import { callSwitcher } from "../callSwitcher";
import { HISTORY_CHART_PLOT, historyChartGeometry, renderHistoryChart } from "../charts/historyChart";
import { button, el } from "../dom";
import { CALL_NAMES } from "../labels";
import { clearStatus, errorDetail, renderStatus } from "../messages";
import { routeHref } from "../router";
import { showStorageWarning, storageUseText, storageWarningBanner } from "../storageUse";
import { DataSection } from "./history/backup";
import { attemptStatus, chartDescription, chartPoints, deleteCallQuestion, formatAttemptDate } from "./history/model";
import type { Cleanup, RenderScreen } from "./screen";

const LOAD_FAILED_TEXT = "Your attempts couldn't be loaded.";
const DELETE_CALL_FAILED_TEXT = "Couldn't delete these attempts. Try again.";
const NOT_ON_CHART_NOTE = "Attempts that weren't judged or couldn't be analyzed aren't on the chart.";

/** The History screen for one call: progress chart, attempt list and storage, plus Back up / Restore for everything. */
class HistoryScreen {
  private disposed = false;
  /** Only the newest load may draw, so a slow earlier one can't overwrite a refresh. */
  private loadCount = 0;
  private attemptCount = 0;

  private readonly callName: string;
  private readonly dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  private readonly banner = storageWarningBanner();
  private readonly chartBody = el("div", {}, el("p", {}, "Loading your scores…"));
  private readonly listBody = el("div", {}, el("p", {}, "Loading your attempts…"));
  private readonly deleteCallButton: HTMLButtonElement;
  private readonly callStatus = el("div", { class: "status", role: "status", "aria-live": "polite" });
  private readonly storageUse = el("p", {});
  private readonly storageSection: HTMLElement;
  private readonly data: DataSection;

  constructor(
    root: HTMLElement,
    private readonly callType: CallType,
  ) {
    this.callName = CALL_NAMES[callType];
    this.deleteCallButton = button(`Delete all ${this.callName} attempts`, { class: "button danger", hidden: "" });
    this.deleteCallButton.addEventListener("click", () => void this.deleteCall());
    this.storageSection = el("section", { hidden: "" }, el("h2", {}, "Storage on this phone"), this.storageUse);
    this.data = new DataSection({ onChanged: () => this.onDataChanged(), isDisposed: () => this.disposed });

    root.append(
      el("a", { class: "back-link", href: routeHref({ name: "home" }), "aria-label": "Back to Home" }, "‹ Home"),
      el("h1", { tabindex: "-1" }, "History"),
      this.banner,
      callSwitcher("history", callType),
      el("section", {}, el("h2", {}, `${this.callName} scores over time`), this.chartBody),
      el(
        "section",
        {},
        el("h2", {}, `${this.callName} attempts`),
        this.listBody,
        this.deleteCallButton,
        this.callStatus,
      ),
      this.storageSection,
      this.data.element,
    );
    this.refresh();
  }

  readonly cleanup: Cleanup = () => {
    this.disposed = true;
    this.data.dispose();
  };

  /** A restore or Delete everything changed what's stored, so an earlier message about this call is out of date. */
  private onDataChanged(): void {
    clearStatus(this.callStatus);
    this.refresh();
  }

  private refresh(): void {
    void this.loadAttempts();
    void this.loadStorage();
  }

  private async loadAttempts(): Promise<void> {
    const load = ++this.loadCount;
    const current = (): boolean => !this.disposed && load === this.loadCount;
    try {
      const attempts = await (await getDefaultStore()).listAttempts(this.callType);
      if (current()) this.showAttempts(attempts);
    } catch (error) {
      if (!current()) return;
      this.chartBody.replaceChildren(
        el("p", {}, LOAD_FAILED_TEXT),
        el("p", { class: "status-detail" }, errorDetail(error)),
      );
      this.listBody.replaceChildren();
      this.deleteCallButton.hidden = true;
    }
  }

  /** storageEstimate never rejects; it gives null when the browser can't say. */
  private async loadStorage(): Promise<void> {
    const estimate = await storageEstimate();
    if (this.disposed) return;
    showStorageWarning(this.banner, estimate);
    const text = storageUseText(estimate);
    this.storageSection.hidden = text === null;
    this.storageUse.textContent = text ?? "";
  }

  /** `attempts` are newest first, as listAttempts returns them. */
  private showAttempts(attempts: AttemptMeta[]): void {
    this.attemptCount = attempts.length;
    this.deleteCallButton.hidden = attempts.length === 0;
    this.chartBody.replaceChildren(...this.chartView(attempts));
    this.listBody.replaceChildren(this.listView(attempts));
  }

  private chartView(attempts: AttemptMeta[]): Node[] {
    const points = chartPoints(attempts);
    if (points.length === 0) {
      return [el("p", {}, attempts.length === 0 ? "No scores yet." : "None of these attempts has a score yet.")];
    }
    const geometry = historyChartGeometry(points, HISTORY_CHART_PLOT.width, HISTORY_CHART_PLOT.height);
    const chart: Node[] = [renderHistoryChart(geometry, chartDescription(points))];
    if (points.length < attempts.length) chart.push(el("p", { class: "hint" }, NOT_ON_CHART_NOTE));
    return chart;
  }

  private listView(attempts: AttemptMeta[]): HTMLElement {
    if (attempts.length === 0) {
      return el(
        "div",
        {},
        el("p", {}, `No ${this.callName} attempts yet.`),
        el(
          "a",
          { class: "button secondary", href: routeHref({ name: "practice", callType: this.callType }) },
          `Practice ${this.callName}`,
        ),
      );
    }
    return el("ul", { class: "attempt-list" }, ...attempts.map((attempt) => this.row(attempt)));
  }

  private row(attempt: AttemptMeta): HTMLElement {
    const status = attemptStatus(attempt);
    return el(
      "li",
      {},
      el(
        "a",
        { class: "attempt-row", href: routeHref({ name: "results", id: attempt.id }) },
        el("span", { class: "attempt-date" }, formatAttemptDate(attempt.createdAt, this.dateFormat)),
        el("span", { class: `attempt-status ${status.kind}` }, status.text),
      ),
    );
  }

  private async deleteCall(): Promise<void> {
    if (this.attemptCount === 0 || !window.confirm(deleteCallQuestion(this.callName, this.attemptCount))) return;
    this.deleteCallButton.disabled = true;
    try {
      await (await getDefaultStore()).deleteAttemptsFor(this.callType);
      if (this.disposed) return;
      renderStatus(this.callStatus, { text: `All ${this.callName} attempts were deleted.` });
      this.refresh();
    } catch (error) {
      if (this.disposed) return;
      renderStatus(this.callStatus, { text: DELETE_CALL_FAILED_TEXT, detail: errorDetail(error), error: true });
    } finally {
      this.deleteCallButton.disabled = false;
    }
  }
}

export const renderHistory: RenderScreen<{ callType: CallType }> = (root, route) =>
  new HistoryScreen(root, route.callType).cleanup;
