/** Decoding audio back to samples: a saved recording for Retry analysis, or an imported reference file. */

/**
 * The rate files are decoded at when the browser can decode offline. Phones record at 48 kHz, and the analysis
 * works at any rate.
 */
const DECODE_SAMPLE_RATE = 48_000;

export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: number;
  /** True when the audio was longer than the limit asked for, so only its start is in `pcm`. */
  truncated: boolean;
}

/** Averages channels sample by sample into a new mono buffer, keeping at most the first `maxLength` samples. */
export function mixToMono(channels: readonly Float32Array[], maxLength = Infinity): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const length = Math.min(maxLength, ...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i];
  }
  if (channels.length > 1) {
    for (let i = 0; i < length; i++) mono[i] /= channels.length;
  }
  return mono;
}

/** How many of `totalLength` samples the first `maxSeconds` hold, and whether that leaves any out. */
export function cropLength(
  totalLength: number,
  sampleRate: number,
  maxSeconds: number,
): { length: number; truncated: boolean } {
  const limit = Number.isFinite(maxSeconds) ? Math.round(maxSeconds * sampleRate) : Infinity;
  return totalLength > limit ? { length: limit, truncated: true } : { length: totalLength, truncated: false };
}

/** An OfflineAudioContext only decodes (no audio device is opened); older browsers fall back to an AudioContext. */
function decodingContext(): BaseAudioContext & { close?: () => Promise<void> } {
  if (typeof OfflineAudioContext === "function") return new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  return new AudioContext();
}

/**
 * Decodes audio (WebM/Opus, MP4/AAC, MP3, WAV: whatever the browser can read) to mono samples. Only the first
 * `maxSeconds` are mixed, so a long file never needs a second full-length buffer. Rejects when it can't be decoded.
 */
export async function decodeToMono(blob: Blob, maxSeconds = Infinity): Promise<DecodedAudio> {
  const bytes = await blob.arrayBuffer();
  const context = decodingContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    const { length, truncated } = cropLength(buffer.length, buffer.sampleRate, maxSeconds);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    return { pcm: mixToMono(channels, length), sampleRate: buffer.sampleRate, truncated };
  } finally {
    context.close?.().catch(() => undefined);
  }
}
