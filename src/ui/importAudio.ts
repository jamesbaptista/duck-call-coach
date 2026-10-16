import { isAudioMimeType, MAX_AUDIO_BYTES } from "../storage/backup";

/** Checks on an audio file picked to import as a reference, made before the file is read. */

export const FILE_TOO_BIG_TEXT = "That file is over 20 MB.";
export const NOT_AUDIO_TEXT = "That isn't an audio file.";

/**
 * Why the file can't be imported, or null when it may be read. The limits are the ones a backup restores, so an
 * imported reference never makes the next backup fail: at most 20 MB, and an audio media type.
 */
export function checkImportFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size > MAX_AUDIO_BYTES) return FILE_TOO_BIG_TEXT;
  if (!isAudioMimeType(file.type)) return NOT_AUDIO_TEXT;
  return null;
}
