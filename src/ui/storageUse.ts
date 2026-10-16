import { el } from "./dom";

/** How much of the browser's storage allowance the app uses, and the warning shown on Home and History. */

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export const STORAGE_WARNING_TEXT =
  "Your phone is almost out of space for this app. Back up, then delete old attempts.";

/** Above this share of the quota, warn. */
const NEARLY_FULL_SHARE = 0.9;
const BYTES_PER_MB = 1024 * 1024;

/** True when usage is over 90% of the quota. False when the browser can't say, or gives no quota. */
export function isStorageNearlyFull(estimate: StorageEstimate | null): boolean {
  if (estimate === null || !(estimate.quota > 0)) return false;
  return estimate.usage / estimate.quota > NEARLY_FULL_SHARE;
}

/** "Using 1.5 MB of 1,024.0 MB", or null when there is nothing useful to say. `locale` is for tests. */
export function storageUseText(estimate: StorageEstimate | null, locale?: string): string | null {
  if (estimate === null || !(estimate.quota > 0)) return null;
  const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const mb = (bytes: number): string => format.format(bytes / BYTES_PER_MB);
  return `Using ${mb(estimate.usage)} MB of ${mb(estimate.quota)} MB`;
}

/** The warning banner, hidden until `showStorageWarning` finds storage nearly full. */
export function storageWarningBanner(): HTMLElement {
  return el("p", { class: "notice storage-warning", role: "status", hidden: "" }, STORAGE_WARNING_TEXT);
}

export function showStorageWarning(banner: HTMLElement, estimate: StorageEstimate | null): void {
  banner.hidden = !isStorageNearlyFull(estimate);
}
