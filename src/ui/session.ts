import type { AttemptRecord } from "../storage/db";

/**
 * Attempts that could not be saved (for example, storage full), kept in memory for this page load so the
 * Results screen can still show them. Bounded, because each one holds its recording.
 */
const MAX_UNSAVED = 3;
const unsaved = new Map<string, AttemptRecord>();

export function rememberUnsavedAttempt(attempt: AttemptRecord): void {
  unsaved.delete(attempt.id);
  unsaved.set(attempt.id, attempt);
  while (unsaved.size > MAX_UNSAVED) {
    const oldest = unsaved.keys().next().value;
    if (oldest === undefined) break;
    unsaved.delete(oldest);
  }
}

export function getUnsavedAttempt(id: string): AttemptRecord | undefined {
  return unsaved.get(id);
}

/** Call once an attempt has been saved after all (for example, by Retry analysis). */
export function forgetUnsavedAttempt(id: string): void {
  unsaved.delete(id);
}
