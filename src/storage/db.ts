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

/** What is actually kept in IndexedDB: the audio as raw bytes rather than a Blob (ruling R6). */
type Stored<T extends { audio: Blob }> = Omit<T, "audio"> & { audioBytes: ArrayBuffer };

interface SettingRow {
  key: string;
  value: unknown;
}

const DEFAULT_DB_NAME = "duck-call-coach";
const DB_VERSION = 1;
const ATTEMPTS = "attempts";
const REFERENCES = "references";
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

async function toStored<T extends { audio: Blob }>(record: T): Promise<Stored<T>> {
  const { audio, ...rest } = record;
  return { ...rest, audioBytes: await audio.arrayBuffer() };
}

function fromStored<T extends { audio: Blob; mimeType: string }>(stored: Stored<T>): T {
  const { audioBytes, ...rest } = stored;
  return { ...rest, audio: new Blob([audioBytes], { type: stored.mimeType }) } as unknown as T;
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
  function getAllStored<T>(tx: IDBTransaction, storeName: string, callType?: CallType): Promise<T[]> {
    const store = tx.objectStore(storeName);
    return callType === undefined
      ? request(store.getAll() as IDBRequest<T[]>)
      : request(store.index(CALL_TYPE_INDEX).getAll(callType) as IDBRequest<T[]>);
  }

  async function listAttemptsIn(tx: IDBTransaction, callType?: CallType): Promise<AttemptRecord[]> {
    const stored = await getAllStored<Stored<AttemptRecord>>(tx, ATTEMPTS, callType);
    return stored.map((s) => fromStored<AttemptRecord>(s)).sort(newestFirst);
  }

  async function listReferencesIn(tx: IDBTransaction, callType: CallType): Promise<ReferenceRecord[]> {
    const stored = await getAllStored<Stored<ReferenceRecord>>(tx, REFERENCES, callType);
    return stored.map((s) => fromStored<ReferenceRecord>(s)).sort(newestFirst);
  }

  async function deleteKeys(tx: IDBTransaction, storeName: string, keys: IDBValidKey[]): Promise<void> {
    const store = tx.objectStore(storeName);
    await Promise.all(keys.map((key) => request(store.delete(key))));
  }

  async function listAttempts(callType?: CallType): Promise<AttemptRecord[]> {
    if (callType !== undefined) assertCallType(callType);
    return transact(db, [ATTEMPTS], "readonly", (tx) => listAttemptsIn(tx, callType));
  }

  async function listReferences(callType: CallType): Promise<ReferenceRecord[]> {
    assertCallType(callType);
    return transact(db, [REFERENCES], "readonly", (tx) => listReferencesIn(tx, callType));
  }

  return {
    async saveAttempt(attempt: AttemptRecord): Promise<void> {
      assertRecord(attempt);
      const stored = await toStored(attempt);
      await transact(db, [ATTEMPTS], "readwrite", (tx) => request(tx.objectStore(ATTEMPTS).put(stored)));
    },

    async getAttempt(id: string): Promise<AttemptRecord | undefined> {
      const stored = await transact(db, [ATTEMPTS], "readonly", (tx) =>
        request(tx.objectStore(ATTEMPTS).get(id) as IDBRequest<Stored<AttemptRecord> | undefined>),
      );
      return stored === undefined ? undefined : fromStored<AttemptRecord>(stored);
    },

    /** Newest first. */
    listAttempts,

    async deleteAttempt(id: string): Promise<void> {
      await transact(db, [ATTEMPTS], "readwrite", (tx) => deleteKeys(tx, ATTEMPTS, [id]));
    },

    async deleteAttemptsFor(callType: CallType): Promise<void> {
      assertCallType(callType);
      await transact(db, [ATTEMPTS], "readwrite", async (tx) => {
        const keys = await request(tx.objectStore(ATTEMPTS).index(CALL_TYPE_INDEX).getAllKeys(callType));
        await deleteKeys(tx, ATTEMPTS, keys);
      });
    },

    /** Clears attempts and references; settings stay. */
    async deleteAll(): Promise<void> {
      await transact(db, [ATTEMPTS, REFERENCES], "readwrite", async (tx) => {
        await Promise.all([request(tx.objectStore(ATTEMPTS).clear()), request(tx.objectStore(REFERENCES).clear())]);
      });
    },

    async saveReference(reference: ReferenceRecord): Promise<void> {
      assertRecord(reference);
      const stored = await toStored(reference);
      await transact(db, [REFERENCES], "readwrite", (tx) => request(tx.objectStore(REFERENCES).put(stored)));
    },

    /** Newest first. */
    listReferences,

    /**
     * Makes `id` the only active reference of `callType`, or clears them all when `id` is null.
     * Rejects, changing nothing, when `id` is not a reference of that call type.
     */
    async setActiveReference(callType: CallType, id: string | null): Promise<void> {
      assertCallType(callType);
      await transact(db, [REFERENCES], "readwrite", async (tx) => {
        const stored = await getAllStored<Stored<ReferenceRecord>>(tx, REFERENCES, callType);
        if (id !== null && !stored.some((r) => r.id === id)) {
          throw new Error(`No ${callType} reference with id ${id}`);
        }
        const store = tx.objectStore(REFERENCES);
        const changed = stored.filter((r) => r.active !== (r.id === id));
        await Promise.all(changed.map((r) => request(store.put({ ...r, active: r.id === id }))));
      });
    },

    async getActiveReference(callType: CallType): Promise<ReferenceRecord | undefined> {
      const references = await listReferences(callType);
      return references.find((r) => r.active);
    },

    async deleteReference(id: string): Promise<void> {
      await transact(db, [REFERENCES], "readwrite", (tx) => deleteKeys(tx, REFERENCES, [id]));
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
