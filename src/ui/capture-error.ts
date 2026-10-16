export interface CaptureErrorDescription {
  /** A friendly sentence for the user. */
  summary: string;
  /** The original error name and message, for diagnosing on a phone with no console. */
  detail: string;
}

const UNKNOWN_DETAIL = "Unknown error";

function summaryFor(name: string): string {
  if (name === "NotAllowedError") {
    return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.";
  }
  if (name === "NotSupportedError") {
    return "This browser can't record audio the way the app needs. On Android, use Chrome.";
  }
  return "Something went wrong while recording. Try again.";
}

function detailFor(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || "Error";
    return error.message ? `${name}: ${error.message}` : name;
  }
  return typeof error === "string" && error ? error : UNKNOWN_DETAIL;
}

/** Turns a recording failure into a friendly sentence plus the real cause. Show both as text. */
export function describeCaptureError(error: unknown): CaptureErrorDescription {
  const name = error instanceof Error ? error.name : "";
  return { summary: summaryFor(name), detail: detailFor(error) };
}
