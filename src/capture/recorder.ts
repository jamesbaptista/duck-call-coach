import workletUrl from "./pcm-worklet.ts?worker&url";
import { pickMimeType } from "./mime";

export interface ProcessingReport {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  /** True only when all three voice-processing features are reported as exactly false. */
  processingOff: boolean;
}

export interface RecordingResult {
  pcm: Float32Array;
  sampleRate: number;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  processing: ProcessingReport;
}

export type LevelCallback = (levelDb: number, freqDb: Float32Array, binHz: number) => void;

export interface RecordingSession {
  processing: ProcessingReport;
  onLevel(cb: LevelCallback): void;
  stop(): Promise<RecordingResult>;
  cancel(): void;
}

const FFT_SIZE = 2048;
const MIN_LEVEL_DB = -120;
const FLUSH_REQUEST = "flush";
const FLUSH_REPLY = "flushed";
const FLUSH_TIMEOUT_MS = 500;

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

/** Chrome may report a processing mode as a string such as "all" (meaning on) instead of a boolean. */
function toFlag(value: boolean | string | undefined): boolean | null {
  if (value === undefined) return null;
  return typeof value === "string" ? true : value;
}

export function toProcessingReport(settings: MediaTrackSettings): ProcessingReport {
  const echoCancellation = toFlag(settings.echoCancellation);
  const noiseSuppression = toFlag(settings.noiseSuppression);
  const autoGainControl = toFlag(settings.autoGainControl);
  return {
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    processingOff:
      echoCancellation === false && noiseSuppression === false && autoGainControl === false,
  };
}

function namedError(name: "NotAllowedError" | "NotSupportedError", message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const PERMISSION_ERROR_NAMES = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);

function mapCaptureError(error: unknown): Error {
  const name = error instanceof Error ? error.name : "";
  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
  if (PERMISSION_ERROR_NAMES.has(name)) {
    return namedError("NotAllowedError", `Microphone access was denied${detail}`);
  }
  return namedError(
    "NotSupportedError",
    `The microphone could not be opened: ${name || "unknown error"}${detail}`,
  );
}

function isCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext !== "undefined" &&
    "audioWorklet" in AudioContext.prototype &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof MediaRecorder !== "undefined"
  );
}

function rmsDb(samples: Float32Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / samples.length);
  return rms > 0 ? Math.max(MIN_LEVEL_DB, 20 * Math.log10(rms)) : MIN_LEVEL_DB;
}

function concatenate(blocks: Float32Array[]): Float32Array {
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const block of blocks) {
    pcm.set(block, offset);
    offset += block.length;
  }
  return pcm;
}

interface AudioGraph {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  sink: GainNode;
  analyser: AnalyserNode;
  recorder: MediaRecorder;
  mimeType: string;
}

class Capture implements RecordingSession {
  readonly processing: ProcessingReport;
  private state: "recording" | "stopping" | "finished" = "recording";
  private levelCallback: LevelCallback | null = null;
  private frameHandle = 0;
  private readonly blocks: Float32Array[] = [];
  private readonly chunks: Blob[] = [];
  private flushWaiter: (() => void) | null = null;
  private stopPromise: Promise<RecordingResult> | null = null;

  constructor(private readonly graph: AudioGraph) {
    this.processing = toProcessingReport(graph.stream.getAudioTracks()[0].getSettings());
    graph.worklet.port.onmessage = (event: MessageEvent) => this.handleWorkletMessage(event.data);
    graph.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
  }

  start(): void {
    this.graph.recorder.start();
    this.pollLevel();
  }

  onLevel(cb: LevelCallback): void {
    this.levelCallback = cb;
  }

  stop(): Promise<RecordingResult> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === "finished") {
      return Promise.reject(new Error("The recording was cancelled."));
    }
    this.state = "stopping";
    this.stopPromise = this.finish().finally(() => this.release());
    return this.stopPromise;
  }

  cancel(): void {
    if (this.state !== "recording") return;
    this.graph.recorder.ondataavailable = null;
    if (this.graph.recorder.state !== "inactive") this.graph.recorder.stop();
    this.release();
  }

  private async finish(): Promise<RecordingResult> {
    // The level display stops here; the rest of the shutdown still needs the audio graph alive.
    cancelAnimationFrame(this.frameHandle);
    await this.stopRecorder();
    // Stop the microphone before draining the worklet so no further audio arrives behind the flush.
    this.graph.stream.getTracks().forEach((track) => track.stop());
    await this.flushWorklet();

    const pcm = concatenate(this.blocks);
    const sampleRate = this.graph.audioContext.sampleRate;
    const mimeType = this.graph.recorder.mimeType || this.graph.mimeType;
    return {
      pcm,
      sampleRate,
      blob: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      durationMs: (pcm.length / sampleRate) * 1000,
      processing: this.processing,
    };
  }

  private stopRecorder(): Promise<void> {
    const { recorder } = this.graph;
    if (recorder.state === "inactive") return Promise.resolve();
    return new Promise((resolve, reject) => {
      // "stop" fires after the final dataavailable event, so no chunk is missed.
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("The recorder failed while stopping."));
      recorder.stop();
    });
  }

  private flushWorklet(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.flushWaiter = null;
        resolve();
      };
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS);
      this.flushWaiter = done;
      this.graph.worklet.port.postMessage(FLUSH_REQUEST);
    });
  }

  private handleWorkletMessage(data: unknown): void {
    if (data instanceof Float32Array) {
      this.blocks.push(data);
    } else if (data === FLUSH_REPLY) {
      this.flushWaiter?.();
    }
  }

  private pollLevel(): void {
    const { analyser, audioContext } = this.graph;
    const timeDomain = new Float32Array(analyser.fftSize);
    const frequency = new Float32Array(analyser.frequencyBinCount);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const tick = (): void => {
      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getFloatFrequencyData(frequency);
      this.levelCallback?.(rmsDb(timeDomain), frequency, binHz);
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  /** Releases the microphone, audio graph and level loop. Safe to call more than once. */
  private release(): void {
    const { stream, source, worklet, sink, audioContext } = this.graph;
    cancelAnimationFrame(this.frameHandle);
    this.levelCallback = null;
    this.state = "finished";
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    worklet.disconnect();
    sink.disconnect();
    worklet.port.onmessage = null;
    if (audioContext.state !== "closed") {
      audioContext.close().catch(() => undefined);
    }
  }
}

async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  } catch (error) {
    throw mapCaptureError(error);
  }
}

export async function startRecording(): Promise<RecordingSession> {
  if (!isCaptureSupported()) {
    throw namedError(
      "NotSupportedError",
      "This browser cannot record audio with an AudioWorklet and MediaRecorder.",
    );
  }
  const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
  if (mimeType === null) {
    throw namedError("NotSupportedError", "This browser has no supported audio recording format.");
  }

  const stream = await openMicrophone();
  const audioContext = new AudioContext();
  try {
    await audioContext.audioWorklet.addModule(workletUrl);
    await audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
    });
    // A silent sink keeps the worklet in the rendered graph so the browser keeps calling it.
    const sink = audioContext.createGain();
    sink.gain.value = 0;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;

    source.connect(worklet);
    worklet.connect(sink);
    sink.connect(audioContext.destination);
    source.connect(analyser);

    const recorder = new MediaRecorder(stream, { mimeType });
    const capture = new Capture({
      stream,
      audioContext,
      source,
      worklet,
      sink,
      analyser,
      recorder,
      mimeType,
    });
    capture.start();
    return capture;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close().catch(() => undefined);
    throw mapCaptureError(error);
  }
}
