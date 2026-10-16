/** Length limits shared by recording, importing and playing references. */

/** The longest recording, in seconds. An imported reference is cut to the same length and plays no longer. */
export const MAX_RECORDING_S = 15;

/** The longest audio file that may be imported as a reference, in seconds (10 minutes). */
export const MAX_IMPORT_S = 10 * 60;

/** True once playback reaches the part that is never scored, so a reference is heard only as far as it counts. */
export function pastPlaybackLimit(currentTimeS: number, limitS: number = MAX_RECORDING_S): boolean {
  return currentTimeS >= limitS;
}
