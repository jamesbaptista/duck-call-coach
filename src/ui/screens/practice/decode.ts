/** Decoding a saved recording back to samples, for Retry analysis. */

/** Averages channels sample by sample into a new mono buffer. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i];
  }
  if (channels.length > 1) {
    for (let i = 0; i < length; i++) mono[i] /= channels.length;
  }
  return mono;
}

/** Decodes a recording Blob (WebM/Opus or MP4/AAC) to mono samples at the decoder's sample rate. */
export async function decodeToMono(blob: Blob): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const bytes = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    return { pcm: mixToMono(channels), sampleRate: buffer.sampleRate };
  } finally {
    context.close().catch(() => undefined);
  }
}
