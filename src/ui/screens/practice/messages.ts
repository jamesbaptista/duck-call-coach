import { describeCaptureError } from "../../capture-error";
import { el } from "../../dom";
import type { Cleanup } from "../screen";

/** What the Practice screen's live status region says. Everything is shown as text. */
export interface StatusMessage {
  text: string;
  /** Numbered steps, for example how to allow the microphone. */
  steps?: string[];
  /** Further sentences, each its own paragraph. */
  notes?: string[];
  /** The underlying error, for diagnosing on a phone with no console. */
  detail?: string;
  error?: boolean;
}

export const SAVE_FAILED_TEXT =
  "Couldn't save this attempt. Your phone may be out of space: back up and delete old attempts on the History screen.";

export const ANALYZING_TEXT = "Analyzing…";

export const ANALYSIS_FAILED_TEXT =
  "The analysis didn't finish. Your recording is kept: tap Retry analysis to try again.";

const NOT_SUPPORTED_TEXT = "This browser can't record audio here. Use Chrome on Android or Safari on iPhone.";

const ALLOW_MIC_STEPS = [
  "Tap the lock icon next to the web address.",
  "Tap Permissions, then Microphone.",
  "Choose Allow, then tap Record again.",
];

export function renderStatus(region: HTMLElement, message: StatusMessage): void {
  const parts: Node[] = [el("p", {}, message.text)];
  if (message.steps) parts.push(el("ol", { class: "steps" }, ...message.steps.map((step) => el("li", {}, step))));
  for (const note of message.notes ?? []) parts.push(el("p", {}, note));
  if (message.detail) parts.push(el("p", { class: "status-detail" }, message.detail));
  region.replaceChildren(...parts);
  region.classList.toggle("error", message.error === true);
}

/** "Name: message" for any error, shown in small print under a friendly sentence. */
export function errorDetail(error: unknown): string {
  return describeCaptureError(error).detail;
}

/** The message for a recording that couldn't start or finish. */
export function captureErrorMessage(error: unknown): StatusMessage {
  const { summary, detail } = describeCaptureError(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") {
    return {
      text: "The microphone is blocked for this site. To allow it in Chrome:",
      steps: ALLOW_MIC_STEPS,
      detail,
      error: true,
    };
  }
  if (name === "NotSupportedError") return { text: NOT_SUPPORTED_TEXT, detail, error: true };
  return { text: summary, detail, error: true };
}

/**
 * After the microphone was blocked, calls `onUsable` once recording could work again: right away when the
 * browser can't report the permission (or it isn't actually "denied", say the prompt was dismissed), otherwise
 * when the user changes it.
 */
export function watchMicPermission(onUsable: () => void): Cleanup {
  let status: PermissionStatus | null = null;
  let finished = false;
  const stop = (): void => {
    finished = true;
    status?.removeEventListener("change", check);
  };
  const usable = (): void => {
    if (finished) return;
    stop();
    onUsable();
  };
  function check(): void {
    if (status && status.state !== "denied") usable();
  }

  queryMicPermission().then((result) => {
    if (finished) return;
    if (result === null) {
      usable();
      return;
    }
    status = result;
    status.addEventListener("change", check);
    check();
  });
  return stop;
}

/** The microphone permission, or null when this browser can't report it. Never rejects. */
async function queryMicPermission(): Promise<PermissionStatus | null> {
  try {
    return typeof navigator.permissions?.query === "function"
      ? await navigator.permissions.query({ name: "microphone" })
      : null;
  } catch {
    return null;
  }
}
