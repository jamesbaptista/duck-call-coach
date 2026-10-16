import type { AnalysisResult, CallMeasurements, CallType, Note } from "../analysis/types";
import { CALL_TYPES, type Scores } from "../scoring/types";

export interface AttemptRecord {
  id: string;
  callType: CallType;
  createdAt: number;
  analyzerVersion: string;
  analysis: AnalysisResult;
  scores: Scores | null;
  tips: { problems: string[]; positive: string | null };
  audio: Blob;
  mimeType: string;
  durationMs: number;
  processingOff: boolean;
  targetSource: "builtin" | "reference";
  /** Set on records read back when the stored recording is gone; `audio` is then an empty Blob. Never stored. */
  audioMissing?: true;
}

export interface ReferenceRecord {
  id: string;
  callType: CallType;
  name: string;
  createdAt: number;
  audio: Blob;
  mimeType: string;
  measurements: CallMeasurements;
  notes: Note[];
  active: boolean;
  /** Set on records read back when the stored recording is gone; `audio` is then an empty Blob. Never stored. */
  audioMissing?: true;
}

/** An attempt without its audio: what lists and tiles need. */
export type AttemptMeta = Omit<AttemptRecord, "audio" | "audioMissing">;
/** A reference without its audio. */
export type ReferenceMeta = Omit<ReferenceRecord, "audio" | "audioMissing">;

/** Which store a recording belongs to. Attempts and references may share an id, so audio rows are keyed by both. */
export type AudioKind = "attempt" | "reference";

/**
 * Audio lives in its own store, as raw bytes rather than a Blob (ruling R6), so that reading
 * metadata never loads recordings. Rows are keyed `<kind>:<id>`.
 */
interface AudioRow {
  key: string;
  audioBytes: ArrayBuffer;
  mimeType: string;
}

interface SettingRow {
  key: string;
  value: unknown;
}

const DEFAULT_DB_NAME = "duck-call-coach";
const DB_VERSION = 1;
const ATTEMPTS = "attempts";
const REFERENCES = "references";
const AUDIO = "audio";
const SETTINGS = "settings";
const CALL_TYPE_INDEX = "callType";

function audioKey(kind: AudioKind, id: string): string {
  return `${kind}:${id}`;
}

/** IDBRequest as a promise. Only use inside a transaction that is still active. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Runs `work` in one transaction and resolves with its result once the transaction has committed.
 * Rejects with the underlying DOMException if the transaction errors or aborts (for example, storage full),
 * or with the error `work` threw, in which case the transaction is aborted and nothing is written.
 * `work` must only await IDB requests, or the transaction commits early.
 */
function transact<T>(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result: T;
    let workFailure: { error: unknown } | null = null;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => {
      reject(workFailure ? workFailure.error : (tx.error ?? new DOMException("Transaction aborted", "AbortError")));
    };
    work(tx).then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        workFailure = { error };
        try {
          tx.abort();
        } catch {
          // Already finished; the abort or complete handler settles the promise.
        }
      },
    );
  });
}

function isCallType(value: unknown): value is CallType {
  return typeof value === "string" && (CALL_TYPES as readonly string[]).includes(value);
}

function assertCallType(value: unknown): asserts value is CallType {
  if (!isCallType(value)) throw new Error(`Unknown call type: ${String(value)}`);
}

function assertRecord(record: { id: unknown; callType: unknown; audio: unknown }): void {
  if (typeof record.id !== "string" || record.id.length === 0) throw new Error("Record id must be a non-empty string");
  assertCallType(record.callType);
  if (!(record.audio instanceof Blob)) throw new Error("Record audio must be a Blob");
}

/** Splits a record into its metadata row and its audio row. Reads the Blob, so call it before opening a transaction. */
async function splitRecord<T extends { id: string; audio: Blob; mimeType: string; audioMissing?: true }>(
  kind: AudioKind,
  record: T,
): Promise<{ meta: Omit<T, "audio" | "audioMissing">; audioRow: AudioRow }> {
  const { audio, audioMissing: _audioMissing, ...meta } = record;
  const audioRow = { key: audioKey(kind, record.id), audioBytes: await audio.arrayBuffer(), mimeType: record.mimeType };
  return { meta, audioRow };
}

/** Joins stored metadata with its audio row; a missing row gives an empty Blob and `audioMissing: true`. */
function withAudio<M extends { mimeType: string }>(
  meta: M,
  row: AudioRow | undefined,
): M & { audio: Blob; audioMissing?: true } {
  if (row === undefined) return { ...meta, audio: new Blob([], { type: meta.mimeType }), audioMissing: true };
  return { ...meta, audio: new Blob([row.audioBytes], { type: row.mimeType }) };
}

/** Stores an imported recording. Zero bytes means the recording was lost, so no row is written and the record reads as missing. */
async function putAudio(audioStore: IDBObjectStore, row: AudioRow): Promise<void> {
  if (row.audioBytes.byteLength > 0) await request(audioStore.put(row));
}

/** Newest first; ties broken by id descending so the order is deterministic. */
function newestFirst(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function openDb(name: string = DEFAULT_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(ATTEMPTS, { keyPath: "id" }).createIndex(CALL_TYPE_INDEX, CALL_TYPE_INDEX);
      db.createObjectStore(REFERENCES, { keyPath: "id" }).createIndex(CALL_TYPE_INDEX, CALL_TYPE_INDEX);
      db.createObjectStore(AUDIO, { keyPath: "key" });
      db.createObjectStore(SETTINGS, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version of the app (in another tab) upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Storage is blocked by another open tab. Close other tabs and try again."));
  });
}

export function createStore(db: IDBDatabase) {
  function getAllMeta<T>(tx: IDBTransaction, storeName: string, callType?: CallType): Promise<T[]> {
    const store = tx.objectStore(storeName);
    return callType === undefined
      ? request(store.getAll() as IDBRequest<T[]>)
      : request(store.index(CALL_TYPE_INDEX).getAll(callType) as IDBRequest<T[]>);
  }

  async function listAttempts(callType?: CallType): Promise<AttemptMeta[]> {
    if (callType !== undefined) assertCallType(callType);
    const attempts = await transact(db, [ATTEMPTS], "readonly", (tx) => getAllMeta<AttemptMeta>(tx, ATTEMPTS, callType));
    return attempts.sort(newestFirst);
  }

  async function listReferences(callType: CallType): Promise<ReferenceMeta[]> {
    assertCallType(callType);
    const references = await transact(db, [REFERENCES], "readonly", (tx) =>
      getAllMeta<ReferenceMeta>(tx, REFERENCES, callType),
    );
    return references.sort(newestFirst);
  }

  /** Deletes the metadata rows and their audio rows. */
  async function deleteWithAudio(
    tx: IDBTransaction,
    metaStore: string,
    kind: AudioKind,
    ids: IDBValidKey[],
  ): Promise<void> {
    const meta = tx.objectStore(metaStore);
    const audio = tx.objectStore(AUDIO);
    await Promise.all(
      ids.flatMap((id) => [request(meta.delete(id)), request(audio.delete(audioKey(kind, String(id))))]),
    );
  }

  return {
    async saveAttempt(attempt: AttemptRecord): Promise<void> {
      assertRecord(attempt);
      const { meta, audioRow } = await splitRecord("attempt", attempt);
      await transact(db, [ATTEMPTS, AUDIO], "readwrite", async (tx) => {
        await Promise.all([request(tx.objectStore(ATTEMPTS).put(meta)), request(tx.objectStore(AUDIO).put(audioRow))]);
      });
    },

    /** The attempt with its audio, or undefined if there is no such attempt. Lost audio sets `audioMissing`. */
    async getAttempt(id: string): Promise<AttemptRecord | undefined> {
      return transact(db, [ATTEMPTS, AUDIO], "readonly", async (tx) => {
        const meta = await request(tx.objectStore(ATTEMPTS).get(id) as IDBRequest<AttemptMeta | undefined>);
        if (meta === undefined) return undefined;
        const key = audioKey("attempt", id);
        const row = await request(tx.objectStore(AUDIO).get(key) as IDBRequest<AudioRow | undefined>);
        return withAudio(meta, row);
      });
    },

    /** The recording of an attempt or reference, or undefined if there is none. */
    async getAudio(kind: AudioKind, id: string): Promise<Blob | undefined> {
      const row = await transact(db, [AUDIO], "readonly", (tx) =>
        request(tx.objectStore(AUDIO).get(audioKey(kind, id)) as IDBRequest<AudioRow | undefined>),
      );
      return row === undefined ? undefined : withAudio({ mimeType: row.mimeType }, row).audio;
    },

    /** Metadata only, newest first. */
    listAttempts,

    async deleteAttempt(id: string): Promise<void> {
      await transact(db, [ATTEMPTS, AUDIO], "readwrite", (tx) => deleteWithAudio(tx, ATTEMPTS, "attempt", [id]));
    },

    async deleteAttemptsFor(callType: CallType): Promise<void> {
      assertCallType(callType);
      await transact(db, [ATTEMPTS, AUDIO], "readwrite", async (tx) => {
        const ids = await request(tx.objectStore(ATTEMPTS).index(CALL_TYPE_INDEX).getAllKeys(callType));
        await deleteWithAudio(tx, ATTEMPTS, "attempt", ids);
      });
    },

    /** Clears attempts, references and their audio; settings stay. */
    async deleteAll(): Promise<void> {
      await transact(db, [ATTEMPTS, REFERENCES, AUDIO], "readwrite", async (tx) => {
        await Promise.all([ATTEMPTS, REFERENCES, AUDIO].map((name) => request(tx.objectStore(name).clear())));
      });
    },

    /** Saving with `active: true` deactivates the other references of that call type. */
    async saveReference(reference: ReferenceRecord): Promise<void> {
      assertRecord(reference);
      const { meta, audioRow } = await splitRecord("reference", reference);
      await transact(db, [REFERENCES, AUDIO], "readwrite", async (tx) => {
        const store = tx.objectStore(REFERENCES);
        const writes: Promise<unknown>[] = [request(store.put(meta)), request(tx.objectStore(AUDIO).put(audioRow))];
        if (meta.active) {
          const siblings = await getAllMeta<ReferenceMeta>(tx, REFERENCES, meta.callType);
          for (const other of siblings) {
            if (other.active && other.id !== meta.id) writes.push(request(store.put({ ...other, active: false })));
          }
        }
        await Promise.all(writes);
      });
    },

    /** Metadata only, newest first. */
    listReferences,

    /**
     * Makes `id` the only active reference of `callType`, or clears them all when `id` is null.
     * Rejects, changing nothing, when `id` is not a reference of that call type.
     */
    async setActiveReference(callType: CallType, id: string | null): Promise<void> {
      assertCallType(callType);
      await transact(db, [REFERENCES], "readwrite", async (tx) => {
        const references = await getAllMeta<ReferenceMeta>(tx, REFERENCES, callType);
        if (id !== null && !references.some((r) => r.id === id)) {
          throw new Error(`No ${callType} reference with id ${id}`);
        }
        const store = tx.objectStore(REFERENCES);
        const changed = references.filter((r) => r.active !== (r.id === id));
        await Promise.all(changed.map((r) => request(store.put({ ...r, active: r.id === id }))));
      });
    },

    /** The active reference of that call type with its audio, or undefined if none is active. Lost audio sets `audioMissing`. */
    async getActiveReference(callType: CallType): Promise<ReferenceRecord | undefined> {
      assertCallType(callType);
      return transact(db, [REFERENCES, AUDIO], "readonly", async (tx) => {
        const references = await getAllMeta<ReferenceMeta>(tx, REFERENCES, callType);
        const active = references.filter((r) => r.active).sort(newestFirst)[0];
        if (active === undefined) return undefined;
        const key = audioKey("reference", active.id);
        const row = await request(tx.objectStore(AUDIO).get(key) as IDBRequest<AudioRow | undefined>);
        return withAudio(active, row);
      });
    },

    async deleteReference(id: string): Promise<void> {
      await transact(db, [REFERENCES, AUDIO], "readwrite", (tx) => deleteWithAudio(tx, REFERENCES, "reference", [id]));
    },

    /** Flatness of the highest-scoring attempt (ties: newest) that has scores and measurements; null if none. */
    async bestFlatness(callType: CallType): Promise<number | null> {
      const attempts = await listAttempts(callType);
      let bestOverall = -Infinity;
      let bestFlatness: number | null = null;
      for (const { scores, analysis } of attempts) {
        if (scores === null || analysis.measurements === null) continue;
        // Newest first, so a strict comparison keeps the newest among equal scores.
        if (scores.overall > bestOverall) {
          bestOverall = scores.overall;
          bestFlatness = analysis.measurements.flatness;
        }
      }
      return bestFlatness;
    },

    async getSetting<T>(key: string): Promise<T | undefined> {
      const row = await transact(db, [SETTINGS], "readonly", (tx) =>
        request(tx.objectStore(SETTINGS).get(key) as IDBRequest<SettingRow | undefined>),
      );
      return row?.value as T | undefined;
    },

    async setSetting(key: string, value: unknown): Promise<void> {
      const row: SettingRow = { key, value };
      await transact(db, [SETTINGS], "readwrite", (tx) => request(tx.objectStore(SETTINGS).put(row)));
    },

    /** Every attempt and reference with its audio, read in one transaction so the snapshot is consistent. Newest first. */
    async getAllRecords(): Promise<{ attempts: AttemptRecord[]; references: ReferenceRecord[] }> {
      return transact(db, [ATTEMPTS, REFERENCES, AUDIO], "readonly", async (tx) => {
        const [attempts, references, audioRows] = await Promise.all([
          getAllMeta<AttemptMeta>(tx, ATTEMPTS),
          getAllMeta<ReferenceMeta>(tx, REFERENCES),
          request(tx.objectStore(AUDIO).getAll() as IDBRequest<AudioRow[]>),
        ]);
        const audioByKey = new Map(audioRows.map((row) => [row.key, row]));
        return {
          attempts: attempts.sort(newestFirst).map((a) => withAudio(a, audioByKey.get(audioKey("attempt", a.id)))),
          references: references.sort(newestFirst).map((r) => withAudio(r, audioByKey.get(audioKey("reference", r.id)))),
        };
      });
    },

    /**
     * Adds records in one transaction: either all new ones are written or none are. Ids already present in
     * their own store are skipped and the existing record is left untouched. An imported reference is only
     * active when no other reference of its call type is, so the one-active-per-call-type rule holds.
     */
    async importRecords(records: {
      attempts: AttemptRecord[];
      references: ReferenceRecord[];
    }): Promise<{ added: number; skipped: number }> {
      records.attempts.forEach(assertRecord);
      records.references.forEach(assertRecord);
      // Read every Blob now: the transaction below must not wait on anything but IndexedDB requests.
      const attempts = await Promise.all(records.attempts.map((a) => splitRecord("attempt", a)));
      const references = await Promise.all(records.references.map((r) => splitRecord("reference", r)));
      return transact(db, [ATTEMPTS, REFERENCES, AUDIO], "readwrite", async (tx) => {
        const attemptStore = tx.objectStore(ATTEMPTS);
        const referenceStore = tx.objectStore(REFERENCES);
        const audioStore = tx.objectStore(AUDIO);
        const activeCallTypes = new Set(
          (await getAllMeta<ReferenceMeta>(tx, REFERENCES)).filter((r) => r.active).map((r) => r.callType),
        );
        let added = 0;
        let skipped = 0;
        // One record at a time, so a repeated id inside `records` sees the earlier copy and is skipped.
        for (const { meta, audioRow } of attempts) {
          if ((await request(attemptStore.getKey(meta.id))) !== undefined) {
            skipped++;
            continue;
          }
          await Promise.all([request(attemptStore.put(meta)), putAudio(audioStore, audioRow)]);
          added++;
        }
        for (const { meta, audioRow } of references) {
          if ((await request(referenceStore.getKey(meta.id))) !== undefined) {
            skipped++;
            continue;
          }
          const active = meta.active === true && !activeCallTypes.has(meta.callType);
          if (active) activeCallTypes.add(meta.callType);
          await Promise.all([request(referenceStore.put({ ...meta, active })), putAudio(audioStore, audioRow)]);
          added++;
        }
        return { added, skipped };
      });
    },

    /** Closes the connection; every later call rejects. */
    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof createStore>;

let defaultStore: Promise<Store> | null = null;

/** The app-wide store: opens the database on first use and reuses it afterwards. */
export function getDefaultStore(): Promise<Store> {
  if (defaultStore === null) {
    const opening = openDb().then(createStore);
    defaultStore = opening;
    // A failed open (for example, private browsing) must be retryable.
    opening.catch(() => {
      if (defaultStore === opening) defaultStore = null;
    });
  }
  return defaultStore;
}

/** Asks the browser not to evict our data. False when unsupported or refused. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || typeof navigator.storage?.persist !== "function") return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  } catch {
    return null;
  }
}
