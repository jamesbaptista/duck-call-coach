import { ANALYSIS } from "../config/analysis";
import { nextPow2, powerSpectrum } from "./fft";

/** Keeps log10 finite for empty spectrum bins (matches the research's 1e-12 guard). */
const POWER_EPSILON = 1e-12;
/** Fewest samples a note range may hold before its spectrum means anything. */
const MIN_RANGE_SAMPLES = 2;
/** Stand-in for the -Infinity an AnalyserNode reports for digital silence. */
const SILENT_DB = -200;

/** Resonance and fundamental of one note, both read from the same spectrum. */
export interface SpectralPeaks {
  resonanceHz: number;
  fundamentalHz: number | null;
}

interface NoteSpectrum {
  logPowerDb: Float64Array;
  smoothDb: Float64Array;
  binHz: number;
}

/** The part of the signal inside [s0, s1), clamped to the signal; null when under two samples. */
function noteSegment(x: Float32Array, s0: number, s1: number): Float32Array | null {
  const start = Math.max(0, Math.min(x.length, Math.floor(s0)));
  const end = Math.max(0, Math.min(x.length, Math.floor(s1)));
  return end - start < MIN_RANGE_SAMPLES ? null : x.subarray(start, end);
}

/** Window length in bins for the resonance smoothing width (at least one bin). */
function smoothingBins(binHz: number): number {
  return Math.max(1, Math.floor(ANALYSIS.resonanceSmoothHz / binHz));
}

/** Centered moving average that, near the array ends, averages only the neighbours that exist. */
function movingAverage(values: Float64Array, width: number): Float64Array {
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  const before = Math.floor(width / 2);
  const after = Math.floor((width - 1) / 2);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - before);
    const to = Math.min(values.length - 1, i + after);
    out[i] = (prefix[to + 1] - prefix[from]) / (to - from + 1);
  }
  return out;
}

/** First and last bin whose frequency lies in [loHz, hiHz]; null when no bin does. */
function bandBins(binCount: number, binHz: number, loHz: number, hiHz: number): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let bin = 0; bin < binCount; bin++) {
    const hz = bin * binHz;
    if (hz < loHz) continue;
    if (hz > hiHz) break;
    if (first < 0) first = bin;
    last = bin;
  }
  return first < 0 ? null : [first, last];
}

/** Index of the largest value in [first, last]. */
function argMax(values: ArrayLike<number>, first: number, last: number): number {
  let best = first;
  for (let i = first + 1; i <= last; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Log power (dB) of a Hann-windowed note, padded to at least minNoteFftS, with its smoothed copy. */
function noteSpectrum(segment: Float32Array, sampleRate: number): NoteSpectrum {
  const nfft = nextPow2(Math.max(segment.length, Math.floor(sampleRate * ANALYSIS.minNoteFftS)));
  const power = powerSpectrum(segment, nfft);
  const logPowerDb = new Float64Array(power.length);
  for (let i = 0; i < power.length; i++) logPowerDb[i] = 10 * Math.log10(power[i] + POWER_EPSILON);
  const binHz = sampleRate / nfft;
  return { logPowerDb, smoothDb: movingAverage(logPowerDb, smoothingBins(binHz)), binHz };
}

/** Frequency of the peak of the smoothed spectrum inside the resonance band, or null when the band is empty. */
function resonancePeakHz(smoothDb: Float64Array, binHz: number): number | null {
  const band = bandBins(smoothDb.length, binHz, ANALYSIS.resonanceLoHz, ANALYSIS.resonanceHiHz);
  return band ? argMax(smoothDb, band[0], band[1]) * binHz : null;
}

/** The fundamental-band spectrum with its smooth trend removed and its mean subtracted. */
function detrendedBand(spectrum: NoteSpectrum): Float64Array | null {
  const { logPowerDb, smoothDb, binHz } = spectrum;
  const band = bandBins(logPowerDb.length, binHz, ANALYSIS.fundBandLoHz, ANALYSIS.fundBandHiHz);
  if (!band) return null;
  const detrended = new Float64Array(band[1] - band[0] + 1);
  let sum = 0;
  for (let i = 0; i < detrended.length; i++) {
    detrended[i] = logPowerDb[band[0] + i] - smoothDb[band[0] + i];
    sum += detrended[i];
  }
  const mean = sum / detrended.length;
  for (let i = 0; i < detrended.length; i++) detrended[i] -= mean;
  return detrended;
}

/** One-sided autocorrelation of `x` at a single lag. */
function autocorrelationAt(x: Float64Array, lag: number): number {
  let sum = 0;
  for (let i = 0; i + lag < x.length; i++) sum += x[i] * x[i + lag];
  return sum;
}

/**
 * Fundamental from harmonic spacing: the lag (100-700 Hz) at which the detrended 1-4 kHz log spectrum
 * best repeats itself. Null when the repeat is weaker than fundMinStrength.
 */
function harmonicSpacingHz(spectrum: NoteSpectrum): number | null {
  const band = detrendedBand(spectrum);
  if (!band) return null;

  const { binHz } = spectrum;
  const loLag = Math.max(1, Math.floor(ANALYSIS.fundLagLoHz / binHz));
  const hiLag = Math.min(band.length, Math.floor(ANALYSIS.fundLagHiHz / binHz));
  const energy = autocorrelationAt(band, 0);
  if (loLag >= hiLag || energy <= 0) return null;

  let bestLag = loLag;
  let bestValue = -Infinity;
  for (let lag = loLag; lag < hiLag; lag++) {
    const value = autocorrelationAt(band, lag);
    if (value > bestValue) {
      bestValue = value;
      bestLag = lag;
    }
  }
  return bestValue / energy >= ANALYSIS.fundMinStrength ? bestLag * binHz : null;
}

/**
 * Resonance (peak of the 150 Hz-smoothed spectrum between 800 and 4000 Hz) and fundamental (harmonic
 * spacing) of the note in [s0, s1), from a single FFT. NaN resonance and null fundamental for an empty range.
 */
export function spectralPeaks(x: Float32Array, sampleRate: number, s0: number, s1: number): SpectralPeaks {
  const segment = noteSegment(x, s0, s1);
  if (!segment) return { resonanceHz: Number.NaN, fundamentalHz: null };
  const spectrum = noteSpectrum(segment, sampleRate);
  return {
    resonanceHz: resonancePeakHz(spectrum.smoothDb, spectrum.binHz) ?? Number.NaN,
    fundamentalHz: harmonicSpacingHz(spectrum),
  };
}

/** Where the note's energy peaks between 800 and 4000 Hz (its "resonance"); NaN for an empty range. */
export function resonanceHz(x: Float32Array, sampleRate: number, s0: number, s1: number): number {
  return spectralPeaks(x, sampleRate, s0, s1).resonanceHz;
}

/** The note's fundamental from its harmonic spacing; null when too weak or the range is empty. */
export function fundamentalHz(x: Float32Array, sampleRate: number, s0: number, s1: number): number | null {
  return spectralPeaks(x, sampleRate, s0, s1).fundamentalHz;
}

/** Prefix sums of `values`, so any bin range can be summed in constant time. */
function prefixSums(values: Float32Array): Float64Array {
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  return prefix;
}

/** Share of one slice's 0.3-6 kHz energy that sits in its strongest +-150 Hz window above 2.6 kHz. */
function sliceSqueakShare(slice: Float32Array, sampleRate: number): number {
  const nfft = nextPow2(slice.length);
  const power = powerSpectrum(slice, nfft);
  const binHz = sampleRate / nfft;
  const whole = bandBins(power.length, binHz, ANALYSIS.squeakBandLoHz, ANALYSIS.squeakBandHiHz);
  const high = bandBins(power.length, binHz, ANALYSIS.squeakLoHz, ANALYSIS.squeakBandHiHz);
  if (!whole || !high) return 0;

  const sums = prefixSums(power);
  const total = sums[whole[1] + 1] - sums[whole[0]];
  if (total <= 0) return 0;

  const half = Math.max(1, Math.floor(ANALYSIS.squeakHalfWidthHz / binHz));
  let strongest = 0;
  for (let center = high[0]; center <= high[1]; center++) {
    const from = Math.max(high[0], center - half);
    const to = Math.min(high[1], center + half);
    strongest = Math.max(strongest, sums[to + 1] - sums[from]);
  }
  return strongest / total;
}

/**
 * Squeakiness: the highest share, over 30 ms slices (15 ms hop), of the slice's energy packed into one
 * narrow window above 2.6 kHz. 0 when the range holds no full slice.
 */
export function squeakShare(x: Float32Array, sampleRate: number, s0: number, s1: number): number {
  const segment = noteSegment(x, s0, s1);
  if (!segment) return 0;
  const sliceLength = Math.round(ANALYSIS.squeakSliceS * sampleRate);
  const hop = Math.max(1, Math.round(ANALYSIS.squeakHopS * sampleRate));
  let best = 0;
  for (let start = 0; start + sliceLength <= segment.length; start += hop) {
    best = Math.max(best, sliceSqueakShare(segment.subarray(start, start + sliceLength), sampleRate));
  }
  return best;
}

/** Spectral flatness over 0.3-6 kHz: geometric over arithmetic mean of power (1 = noise, near 0 = tonal). NaN for an empty range. */
export function flatness(x: Float32Array, sampleRate: number, s0: number, s1: number): number {
  const segment = noteSegment(x, s0, s1);
  if (!segment) return Number.NaN;
  const nfft = nextPow2(segment.length);
  const power = powerSpectrum(segment, nfft);
  const band = bandBins(power.length, sampleRate / nfft, ANALYSIS.flatLoHz, ANALYSIS.flatHiHz);
  if (!band) return Number.NaN;

  let sumPower = 0;
  let sumLog = 0;
  for (let bin = band[0]; bin <= band[1]; bin++) {
    const value = power[bin] + POWER_EPSILON;
    sumPower += value;
    sumLog += Math.log(value);
  }
  const count = band[1] - band[0] + 1;
  return Math.exp(sumLog / count) / (sumPower / count);
}

/**
 * Resonance from a live AnalyserNode dB spectrum (bin i sits at i * binHz). Null when the resonance band
 * is empty or its loudest raw bin is quieter than liveMinDb.
 */
export function liveResonanceHz(freqDb: Float32Array, binHz: number): number | null {
  const band = bandBins(freqDb.length, binHz, ANALYSIS.resonanceLoHz, ANALYSIS.resonanceHiHz);
  if (!band) return null;
  const db = Float64Array.from(freqDb, (value) => (Number.isFinite(value) ? value : SILENT_DB));
  if (db[argMax(db, band[0], band[1])] < ANALYSIS.liveMinDb) return null;
  return resonancePeakHz(movingAverage(db, smoothingBins(binHz)), binHz);
}
