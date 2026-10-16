const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const SPECTRUM_FLOOR_DB = -200;

export interface AveragedSpectrum {
  /** Power in dB (relative to full scale) for each bin from 0 Hz up to `maxHz`. */
  magnitudeDb: Float32Array;
  binHz: number;
}

/** In-place radix-2 FFT. `real` and `imag` must have the same power-of-two length. */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = real[b] * cos - imag[b] * sin;
        const ti = real[b] * sin + imag[b] * cos;
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
      }
    }
  }
}

/** Mean power spectrum of the whole recording (Hann-windowed frames), 0 Hz up to `maxHz`. */
export function averageSpectrum(pcm: Float32Array, sampleRate: number, maxHz: number): AveragedSpectrum {
  const binHz = sampleRate / FRAME_SIZE;
  const binCount = Math.min(FRAME_SIZE / 2, Math.floor(maxHz / binHz) + 1);
  const window = Float32Array.from({ length: FRAME_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME_SIZE));
  const power = new Float64Array(binCount);
  const real = new Float32Array(FRAME_SIZE);
  const imag = new Float32Array(FRAME_SIZE);

  let frames = 0;
  for (let start = 0; start + FRAME_SIZE <= pcm.length; start += HOP_SIZE) {
    for (let i = 0; i < FRAME_SIZE; i++) real[i] = pcm[start + i] * window[i];
    imag.fill(0);
    fft(real, imag);
    for (let bin = 0; bin < binCount; bin++) power[bin] += real[bin] ** 2 + imag[bin] ** 2;
    frames++;
  }

  const magnitudeDb = new Float32Array(binCount);
  for (let bin = 0; bin < binCount; bin++) {
    const meanPower = frames > 0 ? power[bin] / frames : 0;
    magnitudeDb[bin] = meanPower > 0 ? 10 * Math.log10(meanPower) : SPECTRUM_FLOOR_DB;
  }
  return { magnitudeDb, binHz };
}
