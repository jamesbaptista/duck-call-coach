import type { BackupRecordSummary } from "../storage/backup";
import { CALL_NAMES } from "./labels";
import { formatAttemptDate } from "./screens/history/model";

const RECORD_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "Feed Chuckle attempt from Oct 16, 2026, 3:45 PM" or "Greeting / Hail reference “Dawn hen”", for backup messages. */
export function describeBackupRecord(
  record: BackupRecordSummary,
  format: Intl.DateTimeFormat = RECORD_DATE_FORMAT,
): string {
  const call = CALL_NAMES[record.callType];
  return record.kind === "attempt"
    ? `${call} attempt from ${formatAttemptDate(record.createdAt, format)}`
    : `${call} reference “${record.name}”`;
}

/** "duck-call-coach-backup-2026-10-16.json", dated with the phone's own (local) day. */
export function backupFileName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `duck-call-coach-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
