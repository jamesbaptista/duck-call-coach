export type SpectrumWindow = "hann" | "none";

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
  bitReverse: Uint32Array;
}

const twiddleCache = new Map<number, Twiddles>();

export function nextPow2(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

function twiddlesFor(nfft: number): Twiddles {
  const cached = twiddleCache.get(nfft);
  if (cached) return cached;

  const half = nfft / 2;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / nfft);
    sin[k] = -Math.sin((2 * Math.PI * k) / nfft);
  }
  const bitReverse = new Uint32Array(nfft);
  for (let i = 1, j = 0; i < nfft; i++) {
    let bit = nfft >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    bitReverse[i] = j;
  }
  const twiddles = { cos, sin, bitReverse };
  twiddleCache.set(nfft, twiddles);
  return twiddles;
}

/** In-place iterative radix-2 FFT of a bit-reversed-ordered input. */
function fftInPlace(real: Float64Array, imag: Float64Array, twiddles: Twiddles): void {
  const n = real.length;
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < halfSize; k++) {
        const cos = twiddles.cos[k * stride];
        const sin = twiddles.sin[k * stride];
        const a = start + k;
        const b = a + halfSize;
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

/**
 * Power spectrum |X|^2 for bins 0..nfft/2 of a real signal, zero-padded to `nfft`.
 * A "hann" window (numpy `np.hanning(x.length)`, symmetric) is applied before padding.
 */
export function powerSpectrum(x: Float32Array, nfft: number, window: SpectrumWindow = "hann"): Float32Array {
  if (!isPowerOfTwo(nfft)) throw new RangeError(`nfft must be a power of two, got ${nfft}`);
  if (x.length > nfft) throw new RangeError(`input length ${x.length} exceeds nfft ${nfft}`);

  const twiddles = twiddlesFor(nfft);
  const real = new Float64Array(nfft);
  const imag = new Float64Array(nfft);
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const weight = window === "hann" && n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
    real[twiddles.bitReverse[i]] = x[i] * weight;
  }
  fftInPlace(real, imag, twiddles);

  const bins = nfft / 2 + 1;
  const power = new Float32Array(bins);
  for (let k = 0; k < bins; k++) power[k] = real[k] * real[k] + imag[k] * imag[k];
  return power;
}
