import type { CallType } from "../analysis/types";
import { getDefaultStore, type ReferenceRecord } from "../storage/db";

/** What Play target plays: the active reference's recording, or a bundled hen clip. */
export interface TargetClip {
  url: string;
  label: string;
  /** Frees the clip's object URL, if it has one. */
  release(): void;
}

/** There is no bundled comeback clip, so the comeback plays the hail and says how they differ. */
const BUNDLED_FILE: Record<CallType, string> = {
  quack: "quack.mp3",
  hail: "hail.mp3",
  chuckle: "chuckle.mp3",
  comeback: "hail.mp3",
};

const BUNDLED_LABEL: Record<CallType, string> = {
  quack: "Target: a real hen's quack.",
  hail: "Target: a real hen's hail.",
  chuckle: "Target: a real hen's feed chuckle.",
  comeback: "Hen hail: a comeback is a faster, more urgent version",
};

function bundledClip(callType: CallType): TargetClip {
  return {
    url: `${import.meta.env.BASE_URL}clips/${BUNDLED_FILE[callType]}`,
    label: BUNDLED_LABEL[callType],
    release: () => undefined,
  };
}

export interface PracticeTarget {
  clip: TargetClip;
  /** The active reference, which the attempt is scored against; undefined when the built-in target is used. */
  reference: ReferenceRecord | undefined;
}

function referenceClip(reference: ReferenceRecord): TargetClip | null {
  if (reference.audioMissing || reference.audio.size === 0) return null;
  const url = URL.createObjectURL(reference.audio);
  return { url, label: `Target: your reference “${reference.name}”.`, release: () => URL.revokeObjectURL(url) };
}

/** A reference whose recording is gone still sets the scoring targets, but Play target falls back to a real hen. */
function missingAudioClip(callType: CallType, reference: ReferenceRecord): TargetClip {
  const clip = bundledClip(callType);
  return { ...clip, label: `Target: your reference “${reference.name}”. Its recording is missing, so Play target plays a real hen.` };
}

/** The active reference for a call type, or undefined when there is none or storage can't be read. Never rejects. */
export async function loadActiveReference(callType: CallType): Promise<ReferenceRecord | undefined> {
  try {
    return await (await getDefaultStore()).getActiveReference(callType);
  } catch {
    // Storage is unavailable (for example, a private window); the bundled clip still works.
    return undefined;
  }
}

/** What Play target plays: the reference's recording when there is one and it has audio, else a bundled hen clip. */
export function targetClip(callType: CallType, reference: ReferenceRecord | undefined): TargetClip {
  if (!reference) return bundledClip(callType);
  return referenceClip(reference) ?? missingAudioClip(callType, reference);
}

/** The active reference (if any) and the clip Play target plays. Never rejects. */
export async function loadPracticeTarget(callType: CallType): Promise<PracticeTarget> {
  const reference = await loadActiveReference(callType);
  return { clip: targetClip(callType, reference), reference };
}

export interface PlayerLabels {
  play: string;
  stop: string;
  /** The sentence `onError` gets when playback fails, without the final full stop. */
  failed: string;
}

export const TARGET_LABELS: PlayerLabels = {
  play: "Play target",
  stop: "Stop target",
  failed: "The target recording couldn't be played",
};

/** play() rejects with AbortError when pause() or a new source interrupts it; that is not a playback failure. */
function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Drives a Play/Stop button for one clip. Playback errors go to `onError` as a plain sentence. */
export class ClipPlayer {
  private readonly audio = new Audio();
  private clip: TargetClip | null = null;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly onError: (message: string) => void,
    private readonly labels: PlayerLabels = TARGET_LABELS,
  ) {
    this.audio.preload = "none";
    this.audio.addEventListener("ended", () => this.showStopped());
    button.textContent = labels.play;
    button.disabled = true;
    button.addEventListener("click", () => this.toggle());
  }

  setClip(clip: TargetClip): void {
    this.clip?.release();
    this.clip = clip;
    this.audio.src = clip.url;
    this.button.disabled = false;
  }

  /** Stops playback and rewinds; used before recording so the microphone doesn't hear the target. */
  stop(): void {
    this.audio.pause();
    if (this.audio.readyState > 0) this.audio.currentTime = 0;
    this.showStopped();
  }

  setEnabled(enabled: boolean): void {
    this.button.disabled = !enabled || this.clip === null;
  }

  dispose(): void {
    this.stop();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.clip?.release();
    this.clip = null;
  }

  private toggle(): void {
    if (!this.audio.paused) {
      this.stop();
      return;
    }
    this.button.textContent = this.labels.stop;
    this.audio.play().catch((error: unknown) => {
      // Record, Stop or another player paused it before it started: stop() already reset the button.
      if (isAbortError(error)) return;
      this.showStopped();
      const detail = error instanceof Error ? ` (${error.name})` : "";
      this.onError(`${this.labels.failed}${detail}.`);
    });
  }

  private showStopped(): void {
    this.button.textContent = this.labels.play;
  }
}
