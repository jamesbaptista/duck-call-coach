import { describe, expect, it } from "vitest";
import { createAnalysisClient } from "../../src/analysis/client";
import type { AnalysisReply, AnalysisRequest } from "../../src/analysis/handler";
import type { AnalysisResult, CallType } from "../../src/analysis/types";

const SR = 48000;

type Listener = (event: unknown) => void;

/** A stand-in for a Worker: records what the client posts and lets the test emit replies and failures. */
class FakeWorker {
  posted: { message: AnalysisRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  private listeners = new Map<string, Listener[]>();

  postMessage(message: AnalysisRequest, transfer: Transferable[]): void {
    this.posted.push({ message, transfer });
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(reply: AnalysisReply): void {
    this.emit("message", { data: reply });
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function resultFor(callType: CallType, noiseFloorDb: number): AnalysisResult {
  return { callType, analyzerVersion: "1.0.0", noiseFloorDb, notes: [], measurements: null, quality: "no_notes" };
}

/** A client over fake workers, plus the list of every worker it has created. */
function setup() {
  const workers: FakeWorker[] = [];
  const analyzeInWorker = createAnalysisClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { workers, analyzeInWorker };
}

describe("createAnalysisClient", () => {
  it("creates the worker lazily and reuses it for every call", () => {
    const { workers, analyzeInWorker } = setup();
    expect(workers).toHaveLength(0);
    void analyzeInWorker(new Float32Array(10), SR, "quack").catch(() => {});
    void analyzeInWorker(new Float32Array(10), SR, "hail").catch(() => {});
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(2);
  });

  it("posts the request with the pcm buffer in the transfer list", () => {
    const { workers, analyzeInWorker } = setup();
    const pcm = new Float32Array([0.1, 0.2, 0.3]);
    const buffer = pcm.buffer;
    void analyzeInWorker(pcm, SR, "comeback").catch(() => {});
    const { message, transfer } = workers[0].posted[0];
    expect(message.sampleRate).toBe(SR);
    expect(message.callType).toBe("comeback");
    expect(message.pcm.buffer).toBe(buffer);
    expect(transfer).toEqual([buffer]);
  });

  it("resolves two concurrent calls to their own results, whatever order the replies arrive in", async () => {
    const { workers, analyzeInWorker } = setup();
    const first = analyzeInWorker(new Float32Array(10), SR, "quack");
    const second = analyzeInWorker(new Float32Array(10), SR, "hail");
    const [a, b] = workers[0].posted.map((p) => p.message.id);
    expect(a).not.toBe(b);
    workers[0].reply({ id: b, result: resultFor("hail", -60) });
    workers[0].reply({ id: a, result: resultFor("quack", -50) });
    expect(await first).toEqual(resultFor("quack", -50));
    expect(await second).toEqual(resultFor("hail", -60));
  });

  it("rejects with the worker's message on an error reply, leaving other calls alone", async () => {
    const { workers, analyzeInWorker } = setup();
    const failing = analyzeInWorker(new Float32Array(10), SR, "quack");
    const fine = analyzeInWorker(new Float32Array(10), SR, "quack");
    const [failingId, fineId] = workers[0].posted.map((p) => p.message.id);
    workers[0].reply({ id: failingId, error: "boom" });
    workers[0].reply({ id: fineId, result: resultFor("quack", -50) });
    await expect(failing).rejects.toThrow("boom");
    expect(await fine).toEqual(resultFor("quack", -50));
    expect(workers[0].terminated).toBe(false);
  });

  it("ignores a reply for an unknown id", async () => {
    const { workers, analyzeInWorker } = setup();
    const call = analyzeInWorker(new Float32Array(10), SR, "quack");
    workers[0].reply({ id: 9999, result: resultFor("quack", -1) });
    workers[0].reply({ id: workers[0].posted[0].message.id, result: resultFor("quack", -50) });
    expect(await call).toEqual(resultFor("quack", -50));
  });

  it.each([null, undefined, "text", 42, {}, { result: {} }, { id: "0", result: {} }])(
    "ignores a reply with no usable id (%j) without throwing",
    async (malformed) => {
      const { workers, analyzeInWorker } = setup();
      const call = analyzeInWorker(new Float32Array(10), SR, "quack");
      expect(() => workers[0].emit("message", { data: malformed })).not.toThrow();
      workers[0].reply({ id: workers[0].posted[0].message.id, result: resultFor("quack", -50) });
      expect(await call).toEqual(resultFor("quack", -50));
    },
  );

  it.each([{}, { result: undefined }, { error: 5 }])(
    "rejects the matching call when a reply has neither an error string nor a result (%j)",
    async (body) => {
      const { workers, analyzeInWorker } = setup();
      const call = analyzeInWorker(new Float32Array(10), SR, "quack");
      const id = workers[0].posted[0].message.id;
      expect(() => workers[0].emit("message", { data: { id, ...body } })).not.toThrow();
      await expect(call).rejects.toThrow("malformed reply");
      expect(workers[0].terminated).toBe(false);
    },
  );

  it("rejects every pending call when the worker errors, then discards that worker", async () => {
    const { workers, analyzeInWorker } = setup();
    const first = analyzeInWorker(new Float32Array(10), SR, "quack");
    const second = analyzeInWorker(new Float32Array(10), SR, "hail");
    workers[0].emit("error", { message: "script failed" });
    await expect(first).rejects.toThrow("script failed");
    await expect(second).rejects.toThrow("script failed");
    expect(workers[0].terminated).toBe(true);
  });

  it("rejects pending calls on a messageerror too", async () => {
    const { workers, analyzeInWorker } = setup();
    const call = analyzeInWorker(new Float32Array(10), SR, "quack");
    workers[0].emit("messageerror", {});
    await expect(call).rejects.toThrow(/worker/i);
    expect(workers[0].terminated).toBe(true);
  });

  it("uses a fresh worker for the first call after a crash", async () => {
    const { workers, analyzeInWorker } = setup();
    const crashed = analyzeInWorker(new Float32Array(10), SR, "quack");
    workers[0].emit("error", { message: "dead" });
    await expect(crashed).rejects.toThrow("dead");
    expect(workers).toHaveLength(1);

    const next = analyzeInWorker(new Float32Array(10), SR, "quack");
    expect(workers).toHaveLength(2);
    workers[1].reply({ id: workers[1].posted[0].message.id, result: resultFor("quack", -42) });
    expect(await next).toEqual(resultFor("quack", -42));
  });

  it("ignores late events from a worker it has already discarded", async () => {
    const { workers, analyzeInWorker } = setup();
    const crashed = analyzeInWorker(new Float32Array(10), SR, "quack");
    workers[0].emit("error", { message: "dead" });
    await expect(crashed).rejects.toThrow("dead");
    const next = analyzeInWorker(new Float32Array(10), SR, "quack");
    workers[0].emit("error", { message: "late" });
    expect(workers[1].terminated).toBe(false);
    workers[1].reply({ id: workers[1].posted[0].message.id, result: resultFor("quack", -42) });
    expect(await next).toEqual(resultFor("quack", -42));
  });

  it("rejects the call, and keeps the worker, when posting fails", async () => {
    const { workers, analyzeInWorker } = setup();
    const call = analyzeInWorker(new Float32Array(10), SR, "quack");
    const goodPost = workers[0].postMessage.bind(workers[0]);
    workers[0].postMessage = () => {
      throw new Error("DataCloneError");
    };
    await expect(analyzeInWorker(new Float32Array(10), SR, "quack")).rejects.toThrow("DataCloneError");
    workers[0].postMessage = goodPost;
    workers[0].reply({ id: workers[0].posted[0].message.id, result: resultFor("quack", -50) });
    expect(await call).toEqual(resultFor("quack", -50));
    expect(workers).toHaveLength(1);
  });

  it("after reset (the timeout path), rejects what is pending, kills the stuck worker and starts a fresh one", async () => {
    const { workers, analyzeInWorker } = setup();
    const stuck = analyzeInWorker(new Float32Array(10), SR, "hail");
    const queued = analyzeInWorker(new Float32Array(10), SR, "hail");
    analyzeInWorker.reset("The analysis took longer than 30 s.");
    await expect(stuck).rejects.toThrow("took longer than 30 s");
    await expect(queued).rejects.toThrow("took longer than 30 s");
    expect(workers[0].terminated).toBe(true);

    const retry = analyzeInWorker(new Float32Array(10), SR, "hail");
    expect(workers).toHaveLength(2);
    workers[0].reply({ id: workers[0].posted[0].message.id, result: resultFor("hail", -1) });
    workers[1].reply({ id: workers[1].posted[0].message.id, result: resultFor("hail", -45) });
    expect(await retry).toEqual(resultFor("hail", -45));
  });

  it("does nothing on reset when no worker is running", () => {
    const { workers, analyzeInWorker } = setup();
    analyzeInWorker.reset("nothing to stop");
    expect(workers).toHaveLength(0);
  });

  it("rejects when the worker cannot be created", async () => {
    const analyzeInWorker = createAnalysisClient(() => {
      throw new Error("no workers here");
    });
    await expect(analyzeInWorker(new Float32Array(10), SR, "quack")).rejects.toThrow("no workers here");
  });
});
