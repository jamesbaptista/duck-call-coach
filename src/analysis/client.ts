import type { AnalysisReply, AnalysisRequest } from "./handler";
import type { AnalysisResult, CallType } from "./types";

type AnalyzeFn = (pcm: Float32Array, sampleRate: number, callType: CallType) => Promise<AnalysisResult>;

interface Pending {
  resolve: (result: AnalysisResult) => void;
  reject: (error: Error) => void;
}

/** The slice of Worker the client uses; a real Worker satisfies it. */
interface AnalysisWorker {
  postMessage(message: AnalysisRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<AnalysisReply>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

/**
 * Builds an analysis function over workers from `makeWorker`. The worker is created on the first call
 * and reused. If it crashes, every pending call rejects, the worker is discarded, and the next call
 * creates a fresh one.
 */
export function createAnalysisClient(makeWorker: () => Worker): AnalyzeFn {
  let worker: AnalysisWorker | null = null;
  let nextId = 0;
  const pending = new Map<number, Pending>();

  function failAll(failedWorker: AnalysisWorker, reason: string): void {
    if (worker !== failedWorker) return;
    worker = null;
    failedWorker.terminate();
    const error = new Error(reason);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  }

  function onReply(reply: AnalysisReply): void {
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    if ("error" in reply) call.reject(new Error(reply.error));
    else call.resolve(reply.result);
  }

  function startWorker(): AnalysisWorker {
    const started: AnalysisWorker = makeWorker();
    started.addEventListener("message", (event) => {
      if (worker === started) onReply(event.data);
    });
    started.addEventListener("error", (event) => {
      failAll(started, event.message || "The analysis worker crashed");
    });
    started.addEventListener("messageerror", () => {
      failAll(started, "The analysis worker sent a message that could not be read");
    });
    worker = started;
    return started;
  }

  return (pcm, sampleRate, callType) =>
    new Promise<AnalysisResult>((resolve, reject) => {
      const target = worker ?? startWorker();
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        target.postMessage({ id, pcm, sampleRate, callType }, [pcm.buffer]);
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
}

let defaultClient: AnalyzeFn | null = null;

/**
 * Analyzes a recording off the main thread. The worker is created on first use.
 *
 * The PCM buffer is transferred to the worker, so the caller's `pcm` is detached (length 0) after
 * this call. Copy it first if you still need the samples.
 */
export function analyzeInWorker(pcm: Float32Array, sampleRate: number, callType: CallType): Promise<AnalysisResult> {
  defaultClient ??= createAnalysisClient(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
  return defaultClient(pcm, sampleRate, callType);
}
