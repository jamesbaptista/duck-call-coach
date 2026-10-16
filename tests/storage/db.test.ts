import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, CallMeasurements, CallType } from "../../src/analysis/types";
import type { Scores } from "../../src/scoring/types";
import {
  createStore,
  getDefaultStore,
  openDb,
  requestPersistence,
  storageEstimate,
  type AttemptRecord,
  type ReferenceRecord,
  type Store,
} from "../../src/storage/db";

const MEASUREMENTS: CallMeasurements = {
  noteCount: 5,
  spacingMs: 250,
  spacingCv: 0.1,
  burstSpacingMs: null,
  firstNoteMs: 120,
  lastNoteMs: 100,
  medianNoteMs: 110,
  lastFirstRatio: 0.8,
  loudestIndex: 1,
  fadeDb: -6,
  resonanceHz: 1500,
  resonanceSlopeHzPerNote: -20,
  flatness: 0.3,
  maxSqueakShare: 0.05,
  longNoteCount: 0,
  snrDb: 30,
};

function scoresOf(overall: number): Scores {
  return { overall, subs: { rhythm: overall, notes: overall, pitch: overall, tone: overall }, measures: [] };
}

function analysisOf(callType: CallType, flatness: number | null): AnalysisResult {
  return {
    callType,
    analyzerVersion: "1.0.0",
    noiseFloorDb: -60,
    notes: [],
    measurements: flatness === null ? null : { ...MEASUREMENTS, flatness },
    quality: null,
  };
}

function attempt(id: string, callType: CallType, createdAt: number, over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id,
    callType,
    createdAt,
    analyzerVersion: "1.0.0",
    analysis: analysisOf(callType, 0.3),
    scores: scoresOf(50),
    tips: { problems: ["Slow down."], positive: null },
    audio: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }),
    mimeType: "audio/webm",
    durationMs: 2000,
    processingOff: true,
    targetSource: "builtin",
    ...over,
  };
}

function reference(id: string, callType: CallType, createdAt: number, active = false): ReferenceRecord {
  return {
    id,
    callType,
    name: `Reference ${id}`,
    createdAt,
    audio: new Blob([new Uint8Array([9, 8, 7])], { type: "audio/mp4" }),
    mimeType: "audio/mp4",
    measurements: MEASUREMENTS,
    notes: [
      {
        startS: 0.1,
        endS: 0.2,
        durationMs: 100,
        peakDb: -20,
        resonanceHz: 1500,
        fundamentalHz: null,
        squeakShare: null,
        flatness: 0.3,
      },
    ],
    active,
  };
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

let counter = 0;
let db: IDBDatabase;
let store: Store;

beforeEach(async () => {
  db = await openDb(`test-db-${counter++}`);
  store = createStore(db);
});

afterEach(() => {
  db.close();
});

function countRows(storeName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("openDb", () => {
  it("creates the four stores with the callType indexes on attempts and references", () => {
    expect([...db.objectStoreNames].sort()).toEqual(["attempts", "audio", "references", "settings"]);
    const tx = db.transaction(["attempts", "references", "settings", "audio"], "readonly");
    expect(tx.objectStore("audio").keyPath).toBe("id");
    expect(tx.objectStore("attempts").keyPath).toBe("id");
    expect([...tx.objectStore("attempts").indexNames]).toEqual(["callType"]);
    expect(tx.objectStore("references").keyPath).toBe("id");
    expect([...tx.objectStore("references").indexNames]).toEqual(["callType"]);
    expect(tx.objectStore("settings").keyPath).toBe("key");
    expect(db.version).toBe(1);
  });
});

describe("attempts", () => {
  it("round-trips a record, returning the audio as a Blob with the same bytes and type", async () => {
    const saved = attempt("a1", "quack", 1000, { mimeType: "audio/mp4" });
    await store.saveAttempt(saved);
    const loaded = await store.getAttempt("a1");
    expect(loaded).toBeDefined();
    expect(loaded!.audio).toBeInstanceOf(Blob);
    expect(loaded!.audio.type).toBe("audio/mp4");
    expect(await bytesOf(loaded!.audio)).toEqual([1, 2, 3, 4]);
    expect({ ...loaded!, audio: null }).toEqual({ ...saved, audio: null });
  });

  it("returns undefined for an unknown id", async () => {
    expect(await store.getAttempt("nope")).toBeUndefined();
  });

  it("overwrites a record saved twice with the same id", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000, { durationMs: 1 }));
    await store.saveAttempt(attempt("a1", "quack", 1000, { durationMs: 2 }));
    expect((await store.listAttempts()).map((a) => a.durationMs)).toEqual([2]);
  });

  it("lists only the requested call type, newest first", async () => {
    await store.saveAttempt(attempt("h-old", "hail", 1000));
    await store.saveAttempt(attempt("q1", "quack", 2000));
    await store.saveAttempt(attempt("h-new", "hail", 3000));
    expect((await store.listAttempts("hail")).map((a) => a.id)).toEqual(["h-new", "h-old"]);
    expect((await store.listAttempts()).map((a) => a.id)).toEqual(["h-new", "q1", "h-old"]);
  });

  it("breaks createdAt ties by id descending", async () => {
    await store.saveAttempt(attempt("a", "quack", 1000));
    await store.saveAttempt(attempt("c", "quack", 1000));
    await store.saveAttempt(attempt("b", "quack", 1000));
    expect((await store.listAttempts("quack")).map((a) => a.id)).toEqual(["c", "b", "a"]);
  });

  it("deletes one attempt and ignores unknown ids", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    await store.saveAttempt(attempt("a2", "quack", 2000));
    await store.deleteAttempt("a1");
    await store.deleteAttempt("missing");
    expect((await store.listAttempts()).map((a) => a.id)).toEqual(["a2"]);
  });

  it("deleteAttemptsFor removes one call type and leaves the others", async () => {
    await store.saveAttempt(attempt("h1", "hail", 1000));
    await store.saveAttempt(attempt("h2", "hail", 2000));
    await store.saveAttempt(attempt("q1", "quack", 3000));
    await store.deleteAttemptsFor("hail");
    expect((await store.listAttempts()).map((a) => a.id)).toEqual(["q1"]);
  });

  it("rejects an empty id, a non-string id, an unknown call type and non-Blob audio", async () => {
    await expect(store.saveAttempt(attempt("", "quack", 1))).rejects.toThrow(/id/);
    await expect(store.saveAttempt({ ...attempt("x", "quack", 1), id: 5 as unknown as string })).rejects.toThrow(/id/);
    await expect(store.saveAttempt(attempt("x", "gobble" as CallType, 1))).rejects.toThrow(/call type/i);
    await expect(
      store.saveAttempt({ ...attempt("x", "quack", 1), audio: "nope" as unknown as Blob }),
    ).rejects.toThrow(/audio/i);
    expect(await store.listAttempts()).toEqual([]);
  });

  it("rejects an unknown call type when listing or deleting", async () => {
    await expect(store.listAttempts("gobble" as CallType)).rejects.toThrow(/call type/i);
    await expect(store.deleteAttemptsFor("gobble" as CallType)).rejects.toThrow(/call type/i);
  });
});

describe("audio is kept apart from metadata", () => {
  it("list functions return metadata without audio and never open the audio store", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000, { scores: scoresOf(80) }));
    await store.saveReference(reference("r1", "quack", 1000, true));
    const spy = vi.spyOn(db, "transaction");
    const attempts = await store.listAttempts("quack");
    const allAttempts = await store.listAttempts();
    const references = await store.listReferences("quack");
    await store.bestFlatness("quack");
    const touched = spy.mock.calls.flatMap(([names]) => (Array.isArray(names) ? names : [names]));
    spy.mockRestore();
    expect(touched).not.toContain("audio");
    expect(touched.length).toBeGreaterThan(0);
    for (const row of [...attempts, ...allAttempts, ...references]) {
      expect(row).not.toHaveProperty("audio");
      expect(row).not.toHaveProperty("audioBytes");
    }
    expect(attempts[0]!.id).toBe("a1");
    expect(references[0]!.name).toBe("Reference r1");
  });

  it("getAudio returns the bytes and mime type of an attempt or a reference", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000, { mimeType: "audio/ogg" }));
    await store.saveReference(reference("r1", "hail", 1000));
    const a = await store.getAudio("a1");
    expect(a?.type).toBe("audio/ogg");
    expect(await bytesOf(a!)).toEqual([1, 2, 3, 4]);
    const r = await store.getAudio("r1");
    expect(r?.type).toBe("audio/mp4");
    expect(await bytesOf(r!)).toEqual([9, 8, 7]);
    expect(await store.getAudio("missing")).toBeUndefined();
  });

  it("getActiveReference returns the full record with its audio", async () => {
    await store.saveReference(reference("r1", "hail", 1000, true));
    const active = await store.getActiveReference("hail");
    expect(active?.audio.type).toBe("audio/mp4");
    expect(await bytesOf(active!.audio)).toEqual([9, 8, 7]);
  });

  it("deletes leave no orphan audio rows", async () => {
    await store.saveAttempt(attempt("h1", "hail", 1000));
    await store.saveAttempt(attempt("h2", "hail", 2000));
    await store.saveAttempt(attempt("q1", "quack", 3000));
    await store.saveAttempt(attempt("q2", "quack", 4000));
    await store.saveReference(reference("r1", "hail", 5000));
    await store.saveReference(reference("r2", "hail", 6000));
    expect(await countRows("audio")).toBe(6);

    await store.deleteAttempt("q2");
    expect(await countRows("audio")).toBe(5);
    expect(await store.getAudio("q2")).toBeUndefined();

    await store.deleteAttemptsFor("hail");
    expect(await countRows("audio")).toBe(3);
    expect(await store.getAudio("h1")).toBeUndefined();
    expect(await store.getAudio("q1")).toBeDefined();

    await store.deleteReference("r1");
    expect(await countRows("audio")).toBe(2);
    expect(await store.getAudio("r1")).toBeUndefined();

    await store.setSetting("volume", 7);
    await store.deleteAll();
    expect(await countRows("audio")).toBe(0);
    expect(await countRows("attempts")).toBe(0);
    expect(await countRows("references")).toBe(0);
    expect(await store.getSetting<number>("volume")).toBe(7);
  });

  it("replacing a record overwrites its audio instead of adding a row", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    await store.saveAttempt(attempt("a1", "quack", 1000, { audio: new Blob([new Uint8Array([5])], { type: "audio/webm" }) }));
    expect(await countRows("audio")).toBe(1);
    expect(await bytesOf((await store.getAudio("a1"))!)).toEqual([5]);
  });
});

describe("references", () => {
  it("round-trips audio bytes and type and lists newest first per call type", async () => {
    await store.saveReference(reference("r1", "hail", 1000));
    await store.saveReference(reference("r2", "hail", 2000));
    await store.saveReference(reference("r3", "quack", 3000));
    const hail = await store.listReferences("hail");
    expect(hail.map((r) => r.id)).toEqual(["r2", "r1"]);
    const audio = await store.getAudio("r2");
    expect(audio?.type).toBe("audio/mp4");
    expect(await bytesOf(audio!)).toEqual([9, 8, 7]);
    expect(hail[0]!.notes).toEqual(reference("r2", "hail", 2000).notes);
    expect(hail[0]!.measurements).toEqual(MEASUREMENTS);
  });

  it("setting B active deactivates A for the same call type and leaves other call types alone", async () => {
    await store.saveReference(reference("hailA", "hail", 1000));
    await store.saveReference(reference("hailB", "hail", 2000));
    await store.saveReference(reference("quackA", "quack", 3000));
    await store.setActiveReference("hail", "hailA");
    await store.setActiveReference("quack", "quackA");
    await store.setActiveReference("hail", "hailB");
    expect((await store.getActiveReference("hail"))?.id).toBe("hailB");
    expect((await store.listReferences("hail")).filter((r) => r.active).map((r) => r.id)).toEqual(["hailB"]);
    expect((await store.getActiveReference("quack"))?.id).toBe("quackA");
  });

  it("saving an active reference deactivates the others of its call type only", async () => {
    await store.saveReference(reference("hailA", "hail", 1000, true));
    await store.saveReference(reference("quackA", "quack", 2000, true));
    await store.saveReference(reference("hailB", "hail", 3000, true));
    expect((await store.listReferences("hail")).map((r) => [r.id, r.active])).toEqual([
      ["hailB", true],
      ["hailA", false],
    ]);
    expect((await store.getActiveReference("quack"))?.id).toBe("quackA");
    await store.saveReference(reference("hailC", "hail", 4000, false));
    expect((await store.getActiveReference("hail"))?.id).toBe("hailB");
  });

  it("re-saving the active reference keeps it active", async () => {
    await store.saveReference(reference("hailA", "hail", 1000, true));
    await store.saveReference({ ...reference("hailA", "hail", 1000, true), name: "Renamed" });
    const active = await store.getActiveReference("hail");
    expect(active?.name).toBe("Renamed");
  });

  it("clears the active reference when given null", async () => {
    await store.saveReference(reference("r1", "hail", 1000, true));
    await store.setActiveReference("hail", null);
    expect(await store.getActiveReference("hail")).toBeUndefined();
    expect(await store.listReferences("hail")).toHaveLength(1);
  });

  it("rejects an unknown id or another call type's id and changes nothing", async () => {
    await store.saveReference(reference("hailA", "hail", 1000, true));
    await store.saveReference(reference("quackA", "quack", 2000, true));
    await expect(store.setActiveReference("hail", "missing")).rejects.toThrow(/missing/);
    await expect(store.setActiveReference("hail", "quackA")).rejects.toThrow(/quackA/);
    expect((await store.getActiveReference("hail"))?.id).toBe("hailA");
    expect((await store.getActiveReference("quack"))?.id).toBe("quackA");
  });

  it("returns undefined when no reference is active", async () => {
    await store.saveReference(reference("r1", "hail", 1000));
    expect(await store.getActiveReference("hail")).toBeUndefined();
  });

  it("deletes a reference", async () => {
    await store.saveReference(reference("r1", "hail", 1000));
    await store.deleteReference("r1");
    expect(await store.listReferences("hail")).toEqual([]);
  });

  it("rejects invalid ids and call types", async () => {
    await expect(store.saveReference(reference("", "hail", 1))).rejects.toThrow(/id/);
    await expect(store.saveReference(reference("x", "gobble" as CallType, 1))).rejects.toThrow(/call type/i);
    await expect(store.listReferences("gobble" as CallType)).rejects.toThrow(/call type/i);
    await expect(store.setActiveReference("gobble" as CallType, null)).rejects.toThrow(/call type/i);
  });
});

describe("bestFlatness", () => {
  it("returns the flatness of the top-scoring attempt", async () => {
    await store.saveAttempt(attempt("low", "quack", 1000, { scores: scoresOf(40), analysis: analysisOf("quack", 0.11) }));
    await store.saveAttempt(attempt("top", "quack", 2000, { scores: scoresOf(90), analysis: analysisOf("quack", 0.22) }));
    await store.saveAttempt(attempt("mid", "quack", 3000, { scores: scoresOf(70), analysis: analysisOf("quack", 0.33) }));
    await store.saveAttempt(attempt("other", "hail", 4000, { scores: scoresOf(99), analysis: analysisOf("hail", 0.99) }));
    expect(await store.bestFlatness("quack")).toBe(0.22);
  });

  it("ignores attempts without scores or measurements", async () => {
    await store.saveAttempt(attempt("noscore", "quack", 1000, { scores: null, analysis: analysisOf("quack", 0.5) }));
    await store.saveAttempt(attempt("nomeas", "quack", 2000, { scores: scoresOf(99), analysis: analysisOf("quack", null) }));
    expect(await store.bestFlatness("quack")).toBeNull();
    await store.saveAttempt(attempt("ok", "quack", 3000, { scores: scoresOf(10), analysis: analysisOf("quack", 0.4) }));
    expect(await store.bestFlatness("quack")).toBe(0.4);
  });

  it("prefers the newest attempt among equal overall scores", async () => {
    await store.saveAttempt(attempt("old", "quack", 1000, { scores: scoresOf(80), analysis: analysisOf("quack", 0.1) }));
    await store.saveAttempt(attempt("new", "quack", 2000, { scores: scoresOf(80), analysis: analysisOf("quack", 0.2) }));
    expect(await store.bestFlatness("quack")).toBe(0.2);
  });

  it("is null when there are no attempts", async () => {
    expect(await store.bestFlatness("quack")).toBeNull();
  });
});

describe("settings", () => {
  it("stores and reads values, returning undefined for unknown keys", async () => {
    expect(await store.getSetting("volume")).toBeUndefined();
    await store.setSetting("volume", 7);
    await store.setSetting("flags", { a: [1, 2] });
    expect(await store.getSetting<number>("volume")).toBe(7);
    expect(await store.getSetting("flags")).toEqual({ a: [1, 2] });
    await store.setSetting("volume", 8);
    expect(await store.getSetting<number>("volume")).toBe(8);
  });
});

describe("deleteAll", () => {
  it("empties attempts and references but keeps settings", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    await store.saveReference(reference("r1", "hail", 1000));
    await store.setSetting("volume", 7);
    await store.deleteAll();
    expect(await store.listAttempts()).toEqual([]);
    expect(await store.listReferences("hail")).toEqual([]);
    expect(await store.getSetting<number>("volume")).toBe(7);
  });
});

describe("storage failures", () => {
  it("rejects with the underlying error instead of swallowing it", async () => {
    const closed = await openDb(`test-db-closed-${counter++}`);
    const closedStore = createStore(closed);
    closed.close();
    await expect(closedStore.listAttempts()).rejects.toMatchObject({ name: "InvalidStateError" });
  });
});

describe("getDefaultStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries after a failed open and then reuses the opened store", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(getDefaultStore()).rejects.toThrow(/IndexedDB is not available/);
    vi.unstubAllGlobals();
    const first = getDefaultStore();
    const store = await first;
    try {
      expect(getDefaultStore()).toBe(first);
      await store.setSetting("probe", 1);
      expect(await store.getSetting<number>("probe")).toBe(1);
    } finally {
      await store.deleteAll();
      store.close();
    }
  });
});

describe("requestPersistence and storageEstimate in Node", () => {
  it("return false and null when navigator.storage is missing", async () => {
    expect(await requestPersistence()).toBe(false);
    expect(await storageEstimate()).toBeNull();
  });

  it("use navigator.storage when present", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { storage: { persist: async () => true, estimate: async () => ({ usage: 5, quota: 100 }) } },
    });
    try {
      expect(await requestPersistence()).toBe(true);
      expect(await storageEstimate()).toEqual({ usage: 5, quota: 100 });
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it("return false and null when the storage calls throw", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          persist: async () => {
            throw new Error("denied");
          },
          estimate: async () => {
            throw new Error("denied");
          },
        },
      },
    });
    try {
      expect(await requestPersistence()).toBe(false);
      expect(await storageEstimate()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});
