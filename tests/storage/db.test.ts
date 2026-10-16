import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallType } from "../../src/analysis/types";
import { analysisOf, attempt, bytesOf, MEASUREMENTS, reference, scoresOf } from "../helpers/records";
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
    expect(tx.objectStore("audio").keyPath).toBe("key");
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
    const a = await store.getAudio("attempt", "a1");
    expect(a?.type).toBe("audio/ogg");
    expect(await bytesOf(a!)).toEqual([1, 2, 3, 4]);
    const r = await store.getAudio("reference", "r1");
    expect(r?.type).toBe("audio/mp4");
    expect(await bytesOf(r!)).toEqual([9, 8, 7]);
    expect(await store.getAudio("attempt", "missing")).toBeUndefined();
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
    expect(await store.getAudio("attempt", "q2")).toBeUndefined();

    await store.deleteAttemptsFor("hail");
    expect(await countRows("audio")).toBe(3);
    expect(await store.getAudio("attempt", "h1")).toBeUndefined();
    expect(await store.getAudio("attempt", "q1")).toBeDefined();

    await store.deleteReference("r1");
    expect(await countRows("audio")).toBe(2);
    expect(await store.getAudio("reference", "r1")).toBeUndefined();

    await store.setSetting("volume", 7);
    await store.deleteAll();
    expect(await countRows("audio")).toBe(0);
    expect(await countRows("attempts")).toBe(0);
    expect(await countRows("references")).toBe(0);
    expect(await store.getSetting<number>("volume")).toBe(7);
  });

  it("an attempt and a reference with the same id keep separate audio", async () => {
    const attemptAudio = new Blob([new Uint8Array([1, 1])], { type: "audio/webm" });
    await store.saveAttempt(attempt("same", "quack", 1000, { audio: attemptAudio }));
    await store.saveReference(reference("same", "quack", 1000));
    expect(await countRows("audio")).toBe(2);
    expect(await bytesOf((await store.getAudio("attempt", "same"))!)).toEqual([1, 1]);
    expect(await bytesOf((await store.getAudio("reference", "same"))!)).toEqual([9, 8, 7]);
    expect(await bytesOf((await store.getAttempt("same"))!.audio)).toEqual([1, 1]);

    await store.deleteReference("same");
    expect(await store.getAudio("reference", "same")).toBeUndefined();
    expect(await bytesOf((await store.getAudio("attempt", "same"))!)).toEqual([1, 1]);

    await store.saveReference(reference("same", "quack", 1000));
    await store.deleteAttempt("same");
    expect(await store.getAudio("attempt", "same")).toBeUndefined();
    expect(await bytesOf((await store.getAudio("reference", "same"))!)).toEqual([9, 8, 7]);
  });

  it("returns an empty Blob and audioMissing when the audio row is gone", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000, { mimeType: "audio/mp4" }));
    await store.saveReference(reference("r1", "hail", 1000, true));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("audio", "readwrite");
      tx.objectStore("audio").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const loaded = await store.getAttempt("a1");
    expect(loaded?.audioMissing).toBe(true);
    expect(loaded?.audio.size).toBe(0);
    expect(loaded?.audio.type).toBe("audio/mp4");
    expect(loaded?.durationMs).toBe(2000);
    const active = await store.getActiveReference("hail");
    expect(active?.audioMissing).toBe(true);
    expect(active?.audio.size).toBe(0);
    expect(active?.name).toBe("Reference r1");
    expect(await store.getAudio("attempt", "a1")).toBeUndefined();
  });

  it("does not store the audioMissing flag when a read-back record is saved again", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    const loaded = (await store.getAttempt("a1"))!;
    await store.saveAttempt({ ...loaded, audioMissing: true });
    const [meta] = await store.listAttempts();
    expect(meta).not.toHaveProperty("audioMissing");
  });

  it("replacing a record overwrites its audio instead of adding a row", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    await store.saveAttempt(attempt("a1", "quack", 1000, { audio: new Blob([new Uint8Array([5])], { type: "audio/webm" }) }));
    expect(await countRows("audio")).toBe(1);
    expect(await bytesOf((await store.getAudio("attempt", "a1"))!)).toEqual([5]);
  });
});

describe("references", () => {
  it("round-trips audio bytes and type and lists newest first per call type", async () => {
    await store.saveReference(reference("r1", "hail", 1000));
    await store.saveReference(reference("r2", "hail", 2000));
    await store.saveReference(reference("r3", "quack", 3000));
    const hail = await store.listReferences("hail");
    expect(hail.map((r) => r.id)).toEqual(["r2", "r1"]);
    const audio = await store.getAudio("reference", "r2");
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

  it("getReference returns one reference by id with its audio, active or not", async () => {
    await store.saveReference(reference("r1", "hail", 1000, true));
    await store.saveReference(reference("r2", "hail", 2000, false));
    const inactive = await store.getReference("r2");
    expect(inactive?.id).toBe("r2");
    expect(inactive?.active).toBe(false);
    expect(await bytesOf(inactive!.audio)).toEqual([9, 8, 7]);
    expect(inactive?.audioMissing).toBeUndefined();
    expect(await store.getReference("missing")).toBeUndefined();
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

describe("getAllRecords", () => {
  it("returns every attempt and reference with its audio, newest first", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    await store.saveAttempt(attempt("a2", "hail", 2000));
    await store.saveReference(reference("r1", "quack", 3000, true));
    const all = await store.getAllRecords();
    expect(all.attempts.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(all.references.map((r) => r.id)).toEqual(["r1"]);
    expect(await bytesOf(all.attempts[0].audio)).toEqual([1, 2, 3, 4]);
    expect(await bytesOf(all.references[0].audio)).toEqual([9, 8, 7]);
  });

  it("marks a record whose audio row is gone", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("audio", "readwrite");
      tx.objectStore("audio").delete("attempt:a1");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const all = await store.getAllRecords();
    expect(all.attempts[0].audioMissing).toBe(true);
  });

  it("is empty for an empty database", async () => {
    expect(await store.getAllRecords()).toEqual({ attempts: [], references: [] });
  });
});

describe("importRecords", () => {
  it("writes attempts and references with their audio and counts them", async () => {
    const result = await store.importRecords({
      attempts: [attempt("a1", "quack", 1000), attempt("a2", "hail", 2000)],
      references: [reference("r1", "quack", 3000)],
    });
    expect(result).toEqual({ added: 3, skipped: 0 });
    expect((await store.listAttempts()).map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(await bytesOf((await store.getAudio("attempt", "a1"))!)).toEqual([1, 2, 3, 4]);
    expect(await bytesOf((await store.getAudio("reference", "r1"))!)).toEqual([9, 8, 7]);
    expect((await store.listReferences("quack")).map((r) => r.id)).toEqual(["r1"]);
  });

  it("skips ids already present in the same store and leaves the existing record alone", async () => {
    await store.saveAttempt(attempt("a1", "quack", 1000, { durationMs: 111 }));
    await store.saveReference(reference("shared", "quack", 1000));
    const result = await store.importRecords({
      attempts: [attempt("a1", "quack", 1000, { durationMs: 999 }), attempt("shared", "hail", 2000)],
      references: [reference("shared", "quack", 5000), reference("r2", "hail", 6000)],
    });
    // "shared" exists as a reference but not as an attempt, so only the attempt is new.
    expect(result).toEqual({ added: 2, skipped: 2 });
    expect((await store.getAttempt("a1"))!.durationMs).toBe(111);
    expect((await store.listReferences("quack"))[0].createdAt).toBe(1000);
  });

  it("imports a duplicate id within one call only once", async () => {
    const result = await store.importRecords({
      attempts: [attempt("a1", "quack", 1000, { durationMs: 1 }), attempt("a1", "quack", 1000, { durationMs: 2 })],
      references: [],
    });
    expect(result).toEqual({ added: 1, skipped: 1 });
    expect((await store.getAttempt("a1"))!.durationMs).toBe(1);
  });

  it("imports an active reference as inactive when the call type already has an active one", async () => {
    await store.saveReference(reference("mine", "quack", 1000, true));
    await store.importRecords({
      attempts: [],
      references: [reference("theirs", "quack", 2000, true), reference("other", "hail", 2000, true)],
    });
    expect((await store.getActiveReference("quack"))!.id).toBe("mine");
    expect((await store.listReferences("quack")).find((r) => r.id === "theirs")!.active).toBe(false);
    expect((await store.getActiveReference("hail"))!.id).toBe("other");
  });

  it("keeps at most one imported reference active per call type", async () => {
    await store.importRecords({
      attempts: [],
      references: [reference("x", "quack", 1000, true), reference("y", "quack", 2000, true)],
    });
    const active = (await store.listReferences("quack")).filter((r) => r.active);
    expect(active).toHaveLength(1);
  });

  it("writes no audio row for zero-byte audio, so the record reads back with audioMissing", async () => {
    await store.importRecords({
      attempts: [attempt("a1", "quack", 1000, { audio: new Blob([], { type: "audio/webm" }) })],
      references: [{ ...reference("r1", "quack", 2000), audio: new Blob([], { type: "audio/mp4" }) }],
    });
    expect(await countRows("audio")).toBe(0);
    expect(await store.getAudio("attempt", "a1")).toBeUndefined();
    const loaded = await store.getAttempt("a1");
    expect(loaded!.audioMissing).toBe(true);
    expect(loaded!.audio.size).toBe(0);
    expect((await store.getAllRecords()).references[0].audioMissing).toBe(true);
  });

  it("rolls everything back when a write fails part-way through", async () => {
    await store.saveAttempt(attempt("keep", "quack", 1));
    const unclonable = { ...attempt("bad", "quack", 3), tips: { problems: [() => 1], positive: null } };
    await expect(
      store.importRecords({
        attempts: [attempt("a1", "quack", 1000), unclonable as unknown as AttemptRecord],
        references: [reference("r1", "quack", 2000)],
      }),
    ).rejects.toThrow();
    expect((await store.listAttempts()).map((a) => a.id)).toEqual(["keep"]);
    expect(await countRows("references")).toBe(0);
    expect(await countRows("audio")).toBe(1);
  });

  it("rejects an invalid record before writing anything", async () => {
    await expect(
      store.importRecords({
        attempts: [attempt("a1", "quack", 1000), attempt("a2", "goose" as CallType, 1)],
        references: [],
      }),
    ).rejects.toThrow(/call type/i);
    expect(await store.listAttempts()).toEqual([]);
  });

  it("does nothing for empty input", async () => {
    expect(await store.importRecords({ attempts: [], references: [] })).toEqual({ added: 0, skipped: 0 });
  });
});
