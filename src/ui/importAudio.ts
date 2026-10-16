import { isAudioMimeType, MAX_AUDIO_BYTES } from "../storage/backup";
import { MAX_IMPORT_S } from "./limits";

/** Checks on an audio file picked to import as a reference, made before the file is read. */

export const FILE_TOO_BIG_TEXT = "That file is over 20 MB.";
export const NOT_AUDIO_TEXT = "That isn't an audio file.";
export const TOO_LONG_TEXT = "That recording is too long. Use a clip under 10 minutes.";

/** How long to wait for a file's length before going ahead without it. */
const DURATION_PROBE_TIMEOUT_MS = 5000;

/**
 * Why the file can't be imported, or null when it may be read. The limits are the ones a backup restores, so an
 * imported reference never makes the next backup fail: at most 20 MB, and an audio media type.
 */
export function checkImportFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size > MAX_AUDIO_BYTES) return FILE_TOO_BIG_TEXT;
  if (!isAudioMimeType(file.type)) return NOT_AUDIO_TEXT;
  return null;
}

/**
 * Why the file is too long to import, or null when its length is fine or unknown. Decoding a long file needs memory
 * for all of it, even though only the first 15 s are used, so very long files are refused before decoding.
 */
export function checkImportDuration(durationS: number | null): string | null {
  return durationS !== null && durationS > MAX_IMPORT_S ? TOO_LONG_TEXT : null;
}

/** A media element's duration in seconds, or null when the browser doesn't know it (NaN, or Infinity for some WebM). */
export function knownDuration(duration: number): number | null {
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/**
 * The file's length in seconds, read from its metadata by a detached <audio> element without decoding it. Resolves
 * null when the browser can't tell within `timeoutMs`; never rejects. The object URL is revoked either way.
 */
export function probeDurationS(file: Blob, timeoutMs: number = DURATION_PROBE_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (durationS: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(durationS);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.addEventListener("loadedmetadata", () => finish(knownDuration(audio.duration)));
    audio.addEventListener("error", () => finish(null));
    audio.preload = "metadata";
    audio.src = url;
  });
}
