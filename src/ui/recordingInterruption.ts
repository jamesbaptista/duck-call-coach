import type { RecordingPhase } from "./recordingControl";

/** What happens to a recording when the page is left or hidden part-way through. */

export const LEFT_PAGE_TEXT = "Recording stopped because you left the page. Tap Record to try again.";
export const BACKGROUND_STOP_TEXT = "Recording stopped because the app went to the background. Try again.";

/**
 * True when the page going hidden (screen locked, another app opened) must throw the recording away: the phone may
 * cut the microphone off, and a recording that carries on unseen is not the call the user meant to make. Only a
 * recording in progress is affected; one already stopping is left to finish.
 */
export function discardsWhenHidden(phase: RecordingPhase, visibility: DocumentVisibilityState): boolean {
  return phase === "recording" && visibility === "hidden";
}
