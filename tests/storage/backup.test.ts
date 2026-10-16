import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CallType } from "../../src/analysis/types";
import { encodeBase64 } from "../../src/storage/base64";
import {
  BackupError,
  type BackupData,
  exportBackup,
  importBackup,
  MAX_AUDIO_BYTES,
  MAX_BACKUP_CHARS,
  parseBackup,
} from "../../src/storage/backup";
import { createStore, openDb, type AttemptRecord, type Store } from "../../src/storage/db";
import { analysisOf, attempt, bytesOf, MEASUREMENTS, reference, scoresOf } from "../helpers/records";

// The backup is plain JSON, so tests tamper with it as untyped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let counter = 0;
const opened: IDBDatabase[] = [];

async function newStore(): Promise<{ db: IDBDatabase; store: Store }> {
  const db = await openDb(`backup-test-db-${counter++}`);
  opened.push(db);
  return { db, store: createStore(db) };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

/** Every row of every store, with audio bytes as plain arrays, so two snapshots can be compared. */
function snapshot(db: IDBDatabase): Promise<unknown> {
  const names = ["attempts", "references", "audio", "settings"];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, "readonly");
    const requests = names.map((name) => tx.objectStore(name).getAll());
    tx.oncomplete = () => {
      const rows = requests.map((r) =>
        (r.result as { audioBytes?: ArrayBuffer }[]).map((row) =>
          row.audioBytes === undefined ? row : { ...row, audioBytes: [...new Uint8Array(row.audioBytes)] },
        ),
      );
      resolve(rows);
    };
    tx.onerror = () => reject(tx.error);
  });
}

function clearAudio(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("audio", "readwrite");
    tx.objectStore("audio").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** An attempt with notes, a score breakdown and measurements, so validation has real nesting to cover. */
function richAttempt(id: string, callType: CallType, createdAt: number, over: Partial<AttemptRecord> = {}): AttemptRecord {
  const analysis = analysisOf(callType, 0.3);
  analysis.notes = [
    { startS: 0.1, endS: 0.2, durationMs: 100, peakDb: -20, resonanceHz: 1500, fundamentalHz: 700, squeakShare: 0.1, flatness: 0.3 },
    { startS: 0.4, endS: 0.5, durationMs: 100, peakDb: -22, resonanceHz: 1400, fundamentalHz: null, squeakShare: null, flatness: 0.3 },
  ];
  const scores = scoresOf(77);
  scores.measures = [
    { key: "noteCount", sub: "notes", value: 5, lo: 4, hi: 6, score: 100, weightedLoss: 0 },
    { key: "spacingMs", sub: "rhythm", value: null, lo: 200, hi: 300, score: null, weightedLoss: 0 },
  ];
  scores.subs.pitch = null;
  return { ...attempt(id, callType, createdAt), analysis, scores, ...over };
}

async function populate(store: Store): Promise<void> {
  await store.saveAttempt(richAttempt("a1", "quack", 1000));
  await store.saveAttempt(
    richAttempt("a2", "hail", 500, { scores: null, analysis: { ...analysisOf("hail", null), quality: "too_quiet" } }),
  );
  await store.saveReference(reference("r1", "quack", 3000, true));
  await store.saveReference(reference("r2", "quack", 4000, false));
}

async function backupJson(store: Store): Promise<Json> {
  return JSON.parse(await (await exportBackup(store)).text());
}

/** The restore path the app uses: parse, then import. */
async function restore(store: Store, text: string): Promise<{ added: number; skipped: number }> {
  return importBackup(store, parseBackup(text));
}

describe("exportBackup", () => {
  it("writes a JSON file with the format, version, a timestamp and audio as base64", async () => {
    const { store } = await newStore();
    await populate(store);
    const blob = await exportBackup(store);
    expect(blob.type).toBe("application/json");
    const json = JSON.parse(await blob.text());
    expect(json.format).toBe("duck-call-coach-backup");
    expect(json.version).toBe(1);
    expect(new Date(json.exportedAt).toISOString()).toBe(json.exportedAt);
    expect(json.attempts).toHaveLength(2);
    expect(json.references).toHaveLength(2);
    const a1 = json.attempts.find((a: Json) => a.id === "a1");
    expect(a1.audio).toBe(encodeBase64(new Uint8Array([1, 2, 3, 4])));
    expect(a1.mimeType).toBe("audio/webm");
  });

  it("exports an empty database as a valid backup with no records", async () => {
    const { store } = await newStore();
    const json = await backupJson(store);
    expect(json.attempts).toEqual([]);
    expect(json.references).toEqual([]);
    const { store: target } = await newStore();
    expect(await restore(target, JSON.stringify(json))).toEqual({ added: 0, skipped: 0 });
  });

  it("exports a record whose audio is gone with an empty audio string and no audioMissing flag", async () => {
    const { db, store } = await newStore();
    await store.saveAttempt(richAttempt("a1", "quack", 1000));
    await clearAudio(db);
    const json = await backupJson(store);
    expect(json.attempts[0].audio).toBe("");
    expect("audioMissing" in json.attempts[0]).toBe(false);
  });
});

describe("exportBackup refuses a backup that would not restore", () => {
  it("rejects with the reason when a stored measurement is NaN", async () => {
    const { store } = await newStore();
    await store.saveAttempt(richAttempt("good", "quack", 1000));
    const bad = richAttempt("bad", "quack", 2000);
    bad.analysis.measurements = { ...MEASUREMENTS, flatness: NaN };
    await store.saveAttempt(bad);

    await expect(exportBackup(store)).rejects.toBeInstanceOf(BackupError);
    await expect(exportBackup(store)).rejects.toThrow(/^This backup would not restore: Attempt 1: .*measurements\.flatness/);
  });
});

describe("export then import", () => {
  it("restores identical records into an empty database, with byte-equal audio", async () => {
    const { store: source } = await newStore();
    await populate(source);
    const { store: target } = await newStore();

    const result = await restore(target, await (await exportBackup(source)).text());

    expect(result).toEqual({ added: 4, skipped: 0 });
    expect(await target.listAttempts()).toEqual(await source.listAttempts());
    expect(await target.listReferences("quack")).toEqual(await source.listReferences("quack"));
    const before = await source.getAllRecords();
    const after = await target.getAllRecords();
    for (const kind of ["attempts", "references"] as const) {
      expect(after[kind].map((r) => r.id)).toEqual(before[kind].map((r) => r.id));
      for (let i = 0; i < before[kind].length; i++) {
        expect(await bytesOf(after[kind][i].audio)).toEqual(await bytesOf(before[kind][i].audio));
        expect(after[kind][i].audio.type).toBe(before[kind][i].audio.type);
        expect(after[kind][i].audioMissing).toBeUndefined();
      }
    }
    expect((await target.getActiveReference("quack"))!.id).toBe("r1");
  });

  it("adds nothing the second time", async () => {
    const { store: source } = await newStore();
    await populate(source);
    const { db, store: target } = await newStore();
    const text = await (await exportBackup(source)).text();
    await restore(target, text);
    const before = await snapshot(db);
    expect(await restore(target, text)).toEqual({ added: 0, skipped: 4 });
    expect(await snapshot(db)).toEqual(before);
  });

  it("keeps what is already on the phone and adds only the new records", async () => {
    const { store: source } = await newStore();
    await populate(source);
    const { store: target } = await newStore();
    await target.saveAttempt(richAttempt("a1", "quack", 1000, { durationMs: 12345 }));
    await target.saveReference(reference("mine", "quack", 500, true));

    expect(await restore(target, await (await exportBackup(source)).text())).toEqual({ added: 3, skipped: 1 });
    expect((await target.getAttempt("a1"))!.durationMs).toBe(12345);
    // The backup's active reference arrives inactive because "mine" is already active.
    expect((await target.getActiveReference("quack"))!.id).toBe("mine");
    expect((await target.listReferences("quack")).filter((r) => r.active)).toHaveLength(1);
  });

  it("restores a record whose audio was lost, with an empty recording", async () => {
    const { db, store: source } = await newStore();
    await source.saveAttempt(richAttempt("a1", "quack", 1000));
    await clearAudio(db);
    const { store: target } = await newStore();
    expect(await restore(target, await (await exportBackup(source)).text())).toEqual({ added: 1, skipped: 0 });
    expect((await target.getAudio("attempt", "a1"))!.size).toBe(0);
  });
});

/** Mutates a valid exported backup, so each case differs from a good file in exactly one way. */
type Tamper = (backup: Json) => void;

const REJECTED_BACKUPS: [name: string, tamper: Tamper, message: RegExp][] = [
  ["a wrong format", (b) => (b.format = "something-else"), /format/i],
  ["a missing format", (b) => delete b.format, /format/i],
  ["version 2", (b) => (b.version = 2), /version/i],
  ["a version that is a string", (b) => (b.version = "1"), /version/i],
  ["a missing exportedAt", (b) => delete b.exportedAt, /exportedAt/],
  ["attempts that is not an array", (b) => (b.attempts = {}), /attempts/],
  ["references that is not an array", (b) => (b.references = "none"), /references/],
  ["an attempt that is not an object", (b) => (b.attempts[0] = 5), /Attempt 1/],
  ["an unknown call type", (b) => (b.attempts[1].callType = "goose"), /Attempt 2.*callType/],
  ["a non-audio mimeType", (b) => (b.attempts[0].mimeType = "text/html"), /Attempt 1.*mimeType/],
  ["a mimeType with no subtype", (b) => (b.references[0].mimeType = "audio"), /Reference 1.*mimeType/],
  ["invalid base64", (b) => (b.attempts[0].audio = "not base64!!"), /Attempt 1.*audio/],
  ["base64 with the wrong length", (b) => (b.references[1].audio = "AAA"), /Reference 2.*audio/],
  ["audio that is not a string", (b) => (b.attempts[0].audio = [1, 2]), /Attempt 1.*audio/],
  ["an id of 200 characters", (b) => (b.attempts[0].id = "x".repeat(200)), /Attempt 1.*id/],
  ["an empty id", (b) => (b.references[0].id = ""), /Reference 1.*id/],
  ["an id that is not a string", (b) => (b.attempts[0].id = 7), /Attempt 1.*id/],
  ["a createdAt of yesterday", (b) => (b.attempts[0].createdAt = "yesterday"), /Attempt 1.*createdAt/],
  ["a non-finite number", (b) => (b.attempts[0].durationMs = 1e999), /Attempt 1.*durationMs/],
  ["a null durationMs", (b) => (b.attempts[0].durationMs = null), /Attempt 1.*durationMs/],
  ["a processingOff that is not a boolean", (b) => (b.attempts[0].processingOff = "yes"), /Attempt 1.*processingOff/],
  ["an unknown targetSource", (b) => (b.attempts[0].targetSource = "cloud"), /Attempt 1.*targetSource/],
  ["a missing analyzerVersion", (b) => delete b.attempts[0].analyzerVersion, /Attempt 1.*analyzerVersion/],
  ["an analysis that is not an object", (b) => (b.attempts[0].analysis = "ok"), /Attempt 1.*analysis/],
  ["an unknown quality issue", (b) => (b.attempts[0].analysis.quality = "bad"), /Attempt 1.*analysis\.quality/],
  ["an unknown analysis call type", (b) => (b.attempts[0].analysis.callType = "goose"), /Attempt 1.*analysis\.callType/],
  ["a note with a string field", (b) => (b.attempts[0].analysis.notes[1].peakDb = "loud"), /Attempt 1.*analysis\.notes\[1\]\.peakDb/],
  ["notes that is not an array", (b) => (b.attempts[0].analysis.notes = null), /Attempt 1.*analysis\.notes/],
  ["a measurement that is not a number", (b) => (b.attempts[0].analysis.measurements.noteCount = null), /Attempt 1.*measurements\.noteCount/],
  ["scores that is a string", (b) => (b.attempts[0].scores = "high"), /Attempt 1.*scores/],
  ["an overall score that is a string", (b) => (b.attempts[0].scores.overall = "77"), /Attempt 1.*scores\.overall/],
  ["a score measure with an unknown key", (b) => (b.attempts[0].scores.measures[0].key = "volume"), /Attempt 1.*scores\.measures\[0\]\.key/],
  ["tips that is missing", (b) => delete b.attempts[0].tips, /Attempt 1.*tips/],
  ["a tip that is not a string", (b) => (b.attempts[0].tips.problems = [3]), /Attempt 1.*tips\.problems/],
  ["a positive tip that is a number", (b) => (b.attempts[0].tips.positive = 3), /Attempt 1.*tips\.positive/],
  ["a reference name that is not a string", (b) => (b.references[0].name = 4), /Reference 1.*name/],
  ["a reference active flag that is not a boolean", (b) => (b.references[0].active = 1), /Reference 1.*active/],
  ["reference measurements that is a string", (b) => (b.references[0].measurements = "x"), /Reference 1.*measurements/],
  ["reference measurements that is null", (b) => (b.references[0].measurements = null), /Reference 1.*measurements/],
  ["a reference note with a missing field", (b) => delete b.references[0].notes[0].flatness, /Reference 1.*notes\[0\]\.flatness/],
  ["a duplicate attempt id", (b) => b.attempts.push({ ...b.attempts[0] }), /Attempt 3.*same id/],
  ["a duplicate reference id", (b) => (b.references[1].id = b.references[0].id), /Reference 2.*same id/],
];

describe("a bad backup throws BackupError and importing it changes nothing", () => {
  let db: IDBDatabase;
  let target: Store;
  let goodText: string;

  beforeEach(async () => {
    const { store: source } = await newStore();
    await populate(source);
    goodText = await (await exportBackup(source)).text();
    // The phone already holds other records, so "unchanged" means more than "still empty".
    ({ db, store: target } = await newStore());
    await target.saveAttempt(richAttempt("existing", "chuckle", 500));
    await target.saveReference(reference("existing-ref", "hail", 600, true));
  });

  it.each(REJECTED_BACKUPS)("%s", async (_name, tamper, message) => {
    const backup = JSON.parse(goodText);
    tamper(backup);
    const before = await snapshot(db);

    await expect(restore(target, JSON.stringify(backup))).rejects.toBeInstanceOf(BackupError);
    await expect(restore(target, JSON.stringify(backup))).rejects.toThrow(message);

    expect(await snapshot(db)).toEqual(before);
  });

  it("truncated JSON", async () => {
    const before = await snapshot(db);
    const truncated = goodText.slice(0, goodText.length - 40);
    await expect(restore(target, truncated)).rejects.toBeInstanceOf(BackupError);
    await expect(restore(target, truncated)).rejects.toThrow(/not a valid backup/i);
    expect(await snapshot(db)).toEqual(before);
  });

  it.each([
    ["an empty file", ""],
    ["plain text", "hello"],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON number", "5"],
  ])("%s", async (_name, text) => {
    const before = await snapshot(db);
    await expect(restore(target, text)).rejects.toBeInstanceOf(BackupError);
    expect(await snapshot(db)).toEqual(before);
  });

  it("a bad record after good ones writes none of them", async () => {
    const backup = JSON.parse(goodText);
    backup.references[1].mimeType = "text/html";
    const before = await snapshot(db);
    await expect(restore(target, JSON.stringify(backup))).rejects.toBeInstanceOf(BackupError);
    expect(await snapshot(db)).toEqual(before);
  });
});

describe("size limits", () => {
  function backupWithAudio(bytes: number): string {
    const record = {
      ...JSON.parse(JSON.stringify(richAttempt("big", "quack", 1))),
      audio: encodeBase64(new Uint8Array(bytes)),
    };
    return JSON.stringify({
      format: "duck-call-coach-backup",
      version: 1,
      exportedAt: new Date(0).toISOString(),
      attempts: [record],
      references: [],
    });
  }

  it("accepts audio of exactly 20 MB", () => {
    const data = parseBackup(backupWithAudio(MAX_AUDIO_BYTES));
    expect(data.attempts[0].audio.size).toBe(MAX_AUDIO_BYTES);
  });

  it("rejects audio over 20 MB", () => {
    const text = backupWithAudio(MAX_AUDIO_BYTES + 1);
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(/Attempt 1.*audio.*20 MB/);
  });

  it("rejects a file over 500 MB before parsing it", () => {
    // Only `length` is read before the size check, so a stand-in avoids allocating half a gigabyte.
    const huge = { length: MAX_BACKUP_CHARS + 1 } as unknown as string;
    expect(() => parseBackup(huge)).toThrow(BackupError);
    expect(() => parseBackup(huge)).toThrow(/500 MB/);
  });
});

describe("parseBackup accepts", () => {
  async function goodBackup(): Promise<Json> {
    const { store } = await newStore();
    await populate(store);
    return backupJson(store);
  }

  it("unknown top-level and record keys, and does not keep them", async () => {
    const backup = await goodBackup();
    backup.futureThing = { a: 1 };
    backup.attempts[0].extra = "hello";
    const text = JSON.stringify(backup).replace('"extra"', '"__proto__"').replace('"hello"', '{"polluted":true}');
    const data = parseBackup(text);
    expect(data.attempts).toHaveLength(2);
    expect(Object.keys(data.attempts[0]).sort()).toEqual(
      ["analysis", "analyzerVersion", "audio", "callType", "createdAt", "durationMs", "id", "mimeType", "processingOff", "scores", "targetSource", "tips"],
    );
    expect(({} as Json).polluted).toBeUndefined();
  });

  it("a file that starts with a byte order mark", async () => {
    const backup = await goodBackup();
    expect(parseBackup("﻿" + JSON.stringify(backup)).references).toHaveLength(2);
  });

  it("empty audio, giving an empty recording that keeps its type", async () => {
    const backup = await goodBackup();
    backup.attempts[0].audio = "";
    const data = parseBackup(JSON.stringify(backup));
    expect(data.attempts[0].audio.size).toBe(0);
    expect(data.attempts[0].audio.type).toBe("audio/webm");
  });

  it("an attempt with null scores and null measurements, and a reference with no notes", async () => {
    const { store } = await newStore();
    await store.saveAttempt(attempt("a1", "quack", 1, { scores: null, analysis: analysisOf("quack", null) }));
    await store.saveReference({ ...reference("r1", "quack", 2), measurements: MEASUREMENTS, notes: [] });
    const data = parseBackup(JSON.stringify(await backupJson(store)));
    expect(data.attempts[0].scores).toBeNull();
    expect(data.attempts[0].analysis.measurements).toBeNull();
    expect(data.references[0].notes).toEqual([]);
  });
});

describe("importBackup", () => {
  it("takes the parsed data straight from parseBackup", async () => {
    const { store } = await newStore();
    const parsed: BackupData = parseBackup(
      JSON.stringify({
        format: "duck-call-coach-backup",
        version: 1,
        exportedAt: "2026-10-16T00:00:00.000Z",
        attempts: [],
        references: [],
      }),
    );
    expect(await importBackup(store, parsed)).toEqual({ added: 0, skipped: 0 });
  });
});
