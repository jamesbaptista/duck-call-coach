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
}

/** An attempt without its audio: what lists and tiles need. */
export type AttemptMeta = Omit<AttemptRecord, "audio">;
/** A reference without its audio. */
export type ReferenceMeta = Omit<ReferenceRecord, "audio">;

/**
 * Audio lives in its own store, as raw bytes rather than a Blob (ruling R6), so that reading
 * metadata never loads recordings. Rows are keyed by the owning attempt or reference id.
 */
interface AudioRow {
  id: string;
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
async function splitRecord<T extends { id: string; audio: Blob; mimeType: string }>(
  record: T,
): Promise<{ meta: Omit<T, "audio">; audioRow: AudioRow }> {
  const { audio, ...meta } = record;
  return { meta, audioRow: { id: record.id, audioBytes: await audio.arrayBuffer(), mimeType: record.mimeType } };
}

function audioBlob(row: AudioRow): Blob {
  return new Blob([row.audioBytes], { type: row.mimeType });
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
      db.createObjectStore(AUDIO, { keyPath: "id" });
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
  async function deleteWithAudio(tx: IDBTransaction, metaStore: string, ids: IDBValidKey[]): Promise<void> {
    const meta = tx.objectStore(metaStore);
    const audio = tx.objectStore(AUDIO);
    await Promise.all(ids.flatMap((id) => [request(meta.delete(id)), request(audio.delete(id))]));
  }

  return {
    async saveAttempt(attempt: AttemptRecord): Promise<void> {
      assertRecord(attempt);
      const { meta, audioRow } = await splitRecord(attempt);
      await transact(db, [ATTEMPTS, AUDIO], "readwrite", async (tx) => {
        await Promise.all([request(tx.objectStore(ATTEMPTS).put(meta)), request(tx.objectStore(AUDIO).put(audioRow))]);
      });
    },

    /** The attempt with its audio, or undefined if there is no such attempt. */
    async getAttempt(id: string): Promise<AttemptRecord | undefined> {
      return transact(db, [ATTEMPTS, AUDIO], "readonly", async (tx) => {
        const meta = await request(tx.objectStore(ATTEMPTS).get(id) as IDBRequest<AttemptMeta | undefined>);
        if (meta === undefined) return undefined;
        const row = await request(tx.objectStore(AUDIO).get(id) as IDBRequest<AudioRow | undefined>);
        if (row === undefined) throw new Error(`Audio is missing for attempt ${id}`);
        return { ...meta, audio: audioBlob(row) };
      });
    },

    /** The recording of an attempt or reference, or undefined if there is none. */
    async getAudio(id: string): Promise<Blob | undefined> {
      const row = await transact(db, [AUDIO], "readonly", (tx) =>
        request(tx.objectStore(AUDIO).get(id) as IDBRequest<AudioRow | undefined>),
      );
      return row === undefined ? undefined : audioBlob(row);
    },

    /** Metadata only, newest first. */
    listAttempts,

    async deleteAttempt(id: string): Promise<void> {
      await transact(db, [ATTEMPTS, AUDIO], "readwrite", (tx) => deleteWithAudio(tx, ATTEMPTS, [id]));
    },

    async deleteAttemptsFor(callType: CallType): Promise<void> {
      assertCallType(callType);
      await transact(db, [ATTEMPTS, AUDIO], "readwrite", async (tx) => {
        const ids = await request(tx.objectStore(ATTEMPTS).index(CALL_TYPE_INDEX).getAllKeys(callType));
        await deleteWithAudio(tx, ATTEMPTS, ids);
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
      const { meta, audioRow } = await splitRecord(reference);
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

    /** The active reference of that call type with its audio, or undefined if none is active. */
    async getActiveReference(callType: CallType): Promise<ReferenceRecord | undefined> {
      assertCallType(callType);
      return transact(db, [REFERENCES, AUDIO], "readonly", async (tx) => {
        const references = await getAllMeta<ReferenceMeta>(tx, REFERENCES, callType);
        const active = references.filter((r) => r.active).sort(newestFirst)[0];
        if (active === undefined) return undefined;
        const row = await request(tx.objectStore(AUDIO).get(active.id) as IDBRequest<AudioRow | undefined>);
        if (row === undefined) throw new Error(`Audio is missing for reference ${active.id}`);
        return { ...active, audio: audioBlob(row) };
      });
    },

    async deleteReference(id: string): Promise<void> {
      await transact(db, [REFERENCES, AUDIO], "readwrite", (tx) => deleteWithAudio(tx, REFERENCES, [id]));
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
