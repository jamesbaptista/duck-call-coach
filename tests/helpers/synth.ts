/** Deterministic synthetic signals shared by the analysis tests. */

const HARMONIC_MAX_HZ = 6000;
const FORMANT_WIDTH_HZ = 400;
const FADE_S = 0.005;

export function sine(freq: number, seconds: number, sr: number, amp = 1): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

export interface HarmonicNoteOptions {
  f0: number;
  formantHz: number;
  seconds: number;
  sr: number;
  amp?: number;
}

/** Harmonics of f0 up to 6 kHz, weighted by a Gaussian (width 400 Hz) around `formantHz`, peak-normalised to `amp`. */
export function harmonicNote({ f0, formantHz, seconds, sr, amp = 0.5 }: HarmonicNoteOptions): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const sum = new Float64Array(n);
  for (let k = 1; k * f0 <= HARMONIC_MAX_HZ; k++) {
    const weight = Math.exp(-0.5 * ((k * f0 - formantHz) / FORMANT_WIDTH_HZ) ** 2);
    const omega = (2 * Math.PI * k * f0) / sr;
    for (let i = 0; i < n; i++) sum[i] += weight * Math.sin(omega * i);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(sum[i]));
  const scale = peak > 0 ? amp / peak : 0;
  const fade = Math.min(Math.round(FADE_S * sr), Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    const edge = Math.min(i, n - 1 - i);
    const gain = edge < fade ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / fade) : 1;
    out[i] = sum[i] * scale * gain;
  }
  return out;
}

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian white noise with standard deviation `amp`, reproducible for a given seed. */
export function whiteNoise(seconds: number, sr: number, amp: number, seed: number): Float32Array {
  const n = Math.round(seconds * sr);
  const random = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = 1 - random(); // (0, 1], keeps log finite
    const u2 = random();
    out[i] = amp * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}

export function silence(seconds: number, sr: number): Float32Array {
  return new Float32Array(Math.round(seconds * sr));
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
