// Runs inside the AudioWorkletGlobalScope, which TypeScript's DOM/WebWorker libs do not describe.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

/** Message the main thread sends to ask for an acknowledgement after all queued audio. */
const FLUSH_REQUEST = "flush";
/** Reply sent once every block captured before the request has been posted. */
const FLUSH_REPLY = "flushed";

/** Posts each input block's channel 0 to the main thread as a transferable Float32Array. */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === FLUSH_REQUEST) this.port.postMessage(FLUSH_REPLY);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      // The engine reuses its input buffer, so the block must be copied before it is transferred.
      const block = new Float32Array(channel);
      this.port.postMessage(block, [block.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
