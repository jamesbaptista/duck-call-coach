import { describe, expect, it } from "vitest";
import { isBackupFileTooBig, MAX_BACKUP_CHARS } from "../../src/storage/backup";
import { backupFileName, describeBackupRecord } from "../../src/ui/backupFile";

describe("backupFileName", () => {
  it("names the file after the local date, zero-padded", () => {
    expect(backupFileName(new Date(2026, 0, 6, 9, 5))).toBe("duck-call-coach-backup-2026-01-06.json");
  });

  it("uses the local day, not the UTC one, late in the evening", () => {
    expect(backupFileName(new Date(2026, 9, 16, 23, 59))).toBe("duck-call-coach-backup-2026-10-16.json");
  });
});

describe("isBackupFileTooBig", () => {
  it("allows a file of exactly the backup limit and refuses one a byte larger", () => {
    expect(isBackupFileTooBig(MAX_BACKUP_CHARS)).toBe(false);
    expect(isBackupFileTooBig(MAX_BACKUP_CHARS + 1)).toBe(true);
  });

  it("allows an empty file (parseBackup then explains what is wrong with it)", () => {
    expect(isBackupFileTooBig(0)).toBe(false);
  });
});

describe("describeBackupRecord", () => {
  const format = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  it("names an attempt by its call and when it was recorded", () => {
    const createdAt = Date.UTC(2026, 9, 16, 15, 45);
    expect(describeBackupRecord({ kind: "attempt", callType: "chuckle", createdAt }, format)).toBe(
      `Feed Chuckle attempt from ${format.format(createdAt)}`,
    );
  });

  it("names a reference by its call and name", () => {
    expect(describeBackupRecord({ kind: "reference", callType: "hail", name: "Dawn hen" }, format)).toBe(
      "Greeting / Hail reference “Dawn hen”",
    );
  });

  it("copes with a date that can't be shown", () => {
    expect(describeBackupRecord({ kind: "attempt", callType: "quack", createdAt: Number.NaN }, format)).toMatch(
      /^Quack attempt from /,
    );
  });
});
