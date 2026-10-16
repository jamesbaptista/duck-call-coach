/** "duck-call-coach-backup-2026-10-16.json", dated with the phone's own (local) day. */
export function backupFileName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `duck-call-coach-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
