import { getDefaultStore } from "../../../storage/db";

/**
 * Plays one saved reference at a time from the list. A reference's recording is read from storage only when its
 * Play button is tapped; its object URL is revoked when another reference is played or the list is redrawn.
 */

export const PLAY_LABEL = "Play";
const STOP_LABEL = "Stop";
const MISSING_TEXT = "This reference's recording is missing, so it can't be played.";

/** play() rejects with AbortError when pause() or a new source interrupts it; that is not a playback failure. */
function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export class ReferencePlayer {
  private readonly audio = new Audio();
  private url: string | null = null;
  private loadedId: string | null = null;
  private playingButton: HTMLButtonElement | null = null;
  /** Counts toggles, so a slow read from storage can't start playing after something newer happened. */
  private requestCount = 0;

  constructor(private readonly onError: (message: string) => void) {
    this.audio.preload = "none";
    this.audio.addEventListener("ended", () => this.showStopped());
  }

  /** Plays reference `id`, or stops it when `button` is the one already playing. Never rejects. */
  async toggle(id: string, button: HTMLButtonElement): Promise<void> {
    const wasPlaying = this.playingButton === button && !this.audio.paused;
    this.stop();
    if (wasPlaying) return;
    const request = this.requestCount;
    try {
      if (this.loadedId !== id && !(await this.load(id, request))) return;
    } catch (error) {
      if (request === this.requestCount) this.onError(`The reference couldn't be loaded${detail(error)}.`);
      return;
    }
    this.playingButton = button;
    button.textContent = STOP_LABEL;
    this.audio.play().catch((error: unknown) => {
      // Stop, Record or another Play paused it before it started: stop() already reset the button.
      if (isAbortError(error)) return;
      this.showStopped();
      this.onError(`The reference couldn't be played${detail(error)}.`);
    });
  }

  /** Stops and rewinds, and drops any read from storage still under way. */
  stop(): void {
    this.requestCount++;
    this.audio.pause();
    if (this.audio.readyState > 0) this.audio.currentTime = 0;
    this.showStopped();
  }

  /** Stops and frees the loaded recording; used when the list is redrawn and when the screen is left. */
  reset(): void {
    this.stop();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.url !== null) URL.revokeObjectURL(this.url);
    this.url = null;
    this.loadedId = null;
  }

  /** Reads the recording and makes it the audio's source. False when it is missing or a newer toggle came first. */
  private async load(id: string, request: number): Promise<boolean> {
    const blob = await (await getDefaultStore()).getAudio("reference", id);
    if (request !== this.requestCount) return false;
    if (blob === undefined || blob.size === 0) {
      this.onError(MISSING_TEXT);
      return false;
    }
    this.reset();
    this.url = URL.createObjectURL(blob);
    this.loadedId = id;
    this.audio.src = this.url;
    return true;
  }

  private showStopped(): void {
    if (this.playingButton) this.playingButton.textContent = PLAY_LABEL;
    this.playingButton = null;
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? ` (${error.name})` : "";
}
