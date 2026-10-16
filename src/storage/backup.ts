import type { CallType } from "../analysis/types";
import { encodeBase64 } from "./base64";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  MAX_BACKUP_CHARS,
  problemText,
  readBackup,
  type BackupData,
  type RecordProblem,
} from "./backupSchema";
import type { AttemptRecord, ReferenceRecord, Store } from "./db";

export { BackupError, isAudioMimeType, MAX_AUDIO_BYTES, MAX_BACKUP_CHARS, type BackupData } from "./backupSchema";

const BYTE_ORDER_MARK = 0xfeff;
const BYTES_PER_MB = 1024 * 1024;

/**
 * True when a file is too big to be one of our backups, so restore can refuse it before reading it into memory.
 * A file's text never has more characters than the file has bytes, so this never refuses a backup parseBackup
 * would accept, apart from one so close to the limit that non-ASCII text tips it over (exportBackup refuses those).
 */
export function isBackupFileTooBig(sizeBytes: number): boolean {
  return sizeBytes > MAX_BACKUP_CHARS;
}

/** What a describer is told about a record, to name it in a message. */
export type BackupRecordSummary =
  | { kind: "attempt"; callType: CallType; createdAt: number }
  | { kind: "reference"; callType: CallType; name: string };

/** Names a record for the user, such as "Feed Chuckle attempt from Oct 16, 2026". */
export type RecordDescriber = (record: BackupRecordSummary) => string;

/** A stored record as it appears in the file: the audio becomes base64 text, and the read-back flag is dropped. */
async function toFileRecord<T extends { audio: Blob; audioMissing?: true }>(
  record: T,
): Promise<Omit<T, "audio" | "audioMissing"> & { audio: string }> {
  const { audio, audioMissing: _audioMissing, ...rest } = record;
  // A record whose recording was lost has an empty Blob, which exports as empty text and restores as an empty recording.
  return { ...rest, audio: encodeBase64(new Uint8Array(await audio.arrayBuffer())) };
}

/**
 * Everything the app stores, as one JSON file the user can keep. Audio is base64 text. Throws BackupError if the
 * file would not restore, naming the bad record with `describe` when given (else by its place: "Attempt 2").
 */
export async function exportBackup(store: Store, describe?: RecordDescriber): Promise<Blob> {
  const { attempts, references } = await store.getAllRecords();
  const exportedAt = new Date().toISOString();
  const fileAttempts = await Promise.all(attempts.map(toFileRecord));
  const fileReferences = await Promise.all(references.map(toFileRecord));
  const text = [
    `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"exportedAt":${JSON.stringify(exportedAt)},"attempts":[`,
    fileAttempts.map((record) => JSON.stringify(record)).join(","),
    '],"references":[',
    fileReferences.map((record) => JSON.stringify(record)).join(","),
    "]}",
  ].join("");
  assertRestorable(text, (problem) => recordName(problem, attempts, references, describe));
  const file = new Blob([text], { type: "application/json" });
  if (isBackupFileTooBig(file.size)) {
    throw new BackupError(`This backup would not restore: it is larger than ${MAX_BACKUP_CHARS / BYTES_PER_MB} MB.`);
  }
  return file;
}

/** The describer's name for the record a problem is in, or undefined to keep the file's own "Attempt 2". */
function recordName(
  { list, index }: RecordProblem,
  attempts: readonly AttemptRecord[],
  references: readonly ReferenceRecord[],
  describe: RecordDescriber | undefined,
): string | undefined {
  if (describe === undefined) return undefined;
  if (list === "attempts") {
    const attempt = attempts[index];
    return attempt && describe({ kind: "attempt", callType: attempt.callType, createdAt: attempt.createdAt });
  }
  const reference = references[index];
  return reference && describe({ kind: "reference", callType: reference.callType, name: reference.name });
}

/** Fails now, while the user can still react, rather than handing out a file that restore would refuse. */
function assertRestorable(text: string, nameRecord: (problem: RecordProblem) => string | undefined): void {
  try {
    parseBackup(text);
  } catch (error) {
    if (!(error instanceof BackupError)) throw error;
    const { record } = error;
    const name = record && nameRecord(record);
    const reason = record && name !== undefined ? problemText(name, record.path, record.problem) : error.message;
    throw new BackupError(`This backup would not restore: ${reason}`, record);
  }
}

/**
 * Reads the text of a backup file and checks every part of it. Throws BackupError, with a message fit to show,
 * on the first problem; nothing is returned, and nothing should be written, unless the whole file is good.
 */
export function parseBackup(text: string): BackupData {
  if (text.length > MAX_BACKUP_CHARS) {
    throw new BackupError(`This file is larger than ${MAX_BACKUP_CHARS / BYTES_PER_MB} MB, which is too big to be one of our backups.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text);
  } catch {
    throw new BackupError("This is not a valid backup: the file could not be read. It may be cut off or damaged.");
  }
  return readBackup(raw);
}

/**
 * Adds the records of a parsed backup to the phone in a single all-or-nothing step. Records whose id is already
 * on the phone are skipped and left as they are.
 */
export function importBackup(store: Store, data: BackupData): Promise<{ added: number; skipped: number }> {
  return store.importRecords({ attempts: data.attempts, references: data.references });
}
