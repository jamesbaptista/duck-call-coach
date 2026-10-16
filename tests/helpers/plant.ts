/**
 * Planted mistakes: take a clean hen hail and make one known mistake in it, so the tests can check the
 * measurements notice. Ported from the research script (research-ref/synth_test.py).
 *
 * Every variant except `pitchHigh` cuts the notes out of the clean clip and places them again on a bed of
 * Gaussian noise at the clip's own floor level, so the planted clip has the same background as the real one.
 */
import { highPass } from "../../src/analysis/filter";
import { frameLevelsDb, spanSampleRange } from "../../src/analysis/frames";
import { findNotes, noiseFloorDb } from "../../src/analysis/notes";
import { ANALYSIS } from "../../src/config/analysis";
import { mulberry32, whiteNoise } from "./synth";

const CUT_PAD_S = 0.03;
/** Least silence the uneven variant leaves between a note's end and the next onset (the finder merges gaps under 25 ms). */
const UNEVEN_MIN_SILENCE_S = 0.04;
const FIRST_ONSET_S = 0.3;
const TAIL_S = 0.6;
const BED_SEED = 7;
const JITTER_SEED = 7;
const RASP_SEED = 8;
/** Gentle Hann^0.1 taper on every re-placed note, so a cut edge never clicks. */
const EDGE_TAPER_POWER = 0.1;

const RUSH_KEEP = 0.6;
const RUSH_FADE_S = 0.02;
const RUSH_SPACING = 0.6;
const DRAG_SPACING = 1.8;
const UNEVEN_MIN = 0.55;
const UNEVEN_MAX = 1.45;
const SQUEAK_S = 0.08;
const SQUEAK_START_HZ = 3800;
const SQUEAK_END_HZ = 4200;
const SQUEAK_AMPLITUDE = 0.7;
const RASP_NOISE = 0.8;
const RASP_WINDOW = 200;
/**
 * The brief asks for 1.3x, but hail_b's clean resonance is 1821 Hz and 1.3x only reaches 2366 Hz, still inside the
 * hail range (1500-2400 Hz). 1.4x is the smallest round factor that leaves a clear margin on both fixtures.
 */
const PITCH_FACTOR = 1.4;
/** The brief repeats the middle notes twice; a 4-note hail then has 8 notes, still a normal hail. Repeat until there are more than 10. */
const TOO_MANY_MIN_NOTES = 11;
const TOO_MANY_MIN_REPEATS = 2;

interface Hail {
  sampleRate: number;
  /** The notes with 30 ms padding on both sides, cut from the raw clip. */
  pieces: Float32Array[];
  /** Mean onset-to-onset spacing of the detected notes, in seconds. */
  spacingS: number;
  floorRms: number;
}

function peakOf(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  return peak;
}

/** Finds the notes the way analyze() does, then cuts each out of the raw clip with padding. */
function cutNotes(samples: Float32Array, sampleRate: number): Hail {
  const levels = frameLevelsDb(highPass(samples, sampleRate), sampleRate);
  const floorDb = noiseFloorDb(levels);
  const spans = findNotes(levels, floorDb);
  if (spans.length < 2) throw new Error(`plant: need at least 2 notes in the clean hail, found ${spans.length}`);

  const pad = Math.round(CUT_PAD_S * sampleRate);
  const pieces = spans.map((span) => {
    const [from, to] = spanSampleRange(span, sampleRate, samples.length);
    return samples.slice(Math.max(0, from - pad), Math.min(samples.length, to + pad));
  });
  const firstOnset = spans[0].startFrame;
  const lastOnset = spans[spans.length - 1].startFrame;
  const spacingS = ((lastOnset - firstOnset) * ANALYSIS.hopS) / (spans.length - 1);
  return { sampleRate, pieces, spacingS, floorRms: 10 ** (floorDb / 20) };
}

/** Adds each piece to a Gaussian noise bed at its onset. The bed runs 0.6 s past the last onset plus the longest piece. */
function assemble(hail: Hail, pieces: Float32Array[], onsetsS: number[]): Float32Array {
  const { sampleRate, floorRms } = hail;
  const longest = pieces.reduce((most, piece) => Math.max(most, piece.length), 0);
  const total = Math.round((onsetsS[onsetsS.length - 1] + TAIL_S) * sampleRate) + longest;
  const out = whiteNoise(total / sampleRate, sampleRate, floorRms, BED_SEED);
  pieces.forEach((piece, k) => {
    const start = Math.round(onsetsS[k] * sampleRate);
    for (let i = 0; i < piece.length && start + i < out.length; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (piece.length - 1));
      out[start + i] += piece[i] * hann ** EDGE_TAPER_POWER;
    }
  });
  return out;
}

/** `count` onsets from 0.3 s, `spacingS` apart. */
function evenOnsets(count: number, spacingS: number): number[] {
  return Array.from({ length: count }, (_, k) => FIRST_ONSET_S + k * spacingS);
}

/** Each note keeps its first 60% (the last 20 ms fading out) and the notes come 0.6x as far apart. */
export function rushed(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  const fade = Math.round(RUSH_FADE_S * sampleRate);
  const clipped = hail.pieces.map((piece) => {
    const kept = piece.slice(0, Math.floor(piece.length * RUSH_KEEP));
    for (let i = 0; i < Math.min(fade, kept.length); i++) kept[kept.length - 1 - i] *= i / fade;
    return kept;
  });
  return assemble(hail, clipped, evenOnsets(clipped.length, hail.spacingS * RUSH_SPACING));
}

/** Notes come 1.8x as far apart. */
export function dragging(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  return assemble(hail, hail.pieces, evenOnsets(hail.pieces.length, hail.spacingS * DRAG_SPACING));
}

/**
 * Each gap is the mean spacing times a random factor between 0.55 and 1.45, but never so short that the next note
 * starts on top of the previous one: the hails' notes are nearly as long as their spacing, and two overlapping notes
 * are heard as one long note, not as an uneven rhythm.
 */
export function uneven(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  const random = mulberry32(JITTER_SEED);
  const onsets = [FIRST_ONSET_S];
  for (let k = 1; k < hail.pieces.length; k++) {
    const factor = UNEVEN_MIN + (UNEVEN_MAX - UNEVEN_MIN) * random();
    const noteS = hail.pieces[k - 1].length / sampleRate - 2 * CUT_PAD_S;
    onsets.push(onsets[k - 1] + Math.max(hail.spacingS * factor, noteS + UNEVEN_MIN_SILENCE_S));
  }
  return assemble(hail, hail.pieces, onsets);
}

/** Every note is scaled up or down to the loudest note's peak, so the call never fades. */
export function noFade(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  const loudest = Math.max(...hail.pieces.map(peakOf));
  const flat = hail.pieces.map((piece) => piece.map((v) => (v * loudest) / peakOf(piece)));
  return assemble(hail, flat, evenOnsets(flat.length, hail.spacingS));
}

/** The notes, then the middle notes twice more (or as often as it takes to pass 10 notes), at the original spacing. */
export function tooMany(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  const middle = hail.pieces.slice(1, -1);
  if (middle.length === 0) throw new Error("plant: tooMany needs at least 3 notes in the clean hail");
  const needed = Math.ceil((TOO_MANY_MIN_NOTES - hail.pieces.length) / middle.length);
  const repeats = Math.max(TOO_MANY_MIN_REPEATS, needed);
  const many = [...hail.pieces, ...Array.from({ length: repeats }, () => middle).flat()];
  return assemble(hail, many, evenOnsets(many.length, hail.spacingS));
}

/** An 80 ms Hann-windowed chirp from 3800 to 4200 Hz, 0.7x note 1's peak, added at the start of note 1. */
export function squeak(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  const squeaky = hail.pieces.map((piece) => piece.slice());
  const amplitude = SQUEAK_AMPLITUDE * peakOf(squeaky[0]);
  const length = Math.round(SQUEAK_S * sampleRate);
  const sweepHzPerS = (SQUEAK_END_HZ - SQUEAK_START_HZ) / SQUEAK_S;
  for (let i = 0; i < Math.min(length, squeaky[0].length); i++) {
    const t = i / sampleRate;
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    squeaky[0][i] += amplitude * hann * Math.sin(2 * Math.PI * (SQUEAK_START_HZ * t + 0.5 * sweepHzPerS * t * t));
  }
  return assemble(hail, squeaky, evenOnsets(squeaky.length, hail.spacingS));
}

/** Centred moving average of |x| over `window` samples (zero beyond the ends, like a "same" convolution). */
function movingAverageAbs(x: Float32Array, window: number): Float32Array {
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i] + Math.abs(x[i]);
  const half = Math.floor(window / 2);
  return x.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(x.length, i - half + window);
    return (prefix[to] - prefix[from]) / window;
  });
}

/** Noise with std 0.8x the note's own 200-sample moving average of |note| is added to every note. */
export function raspy(samples: Float32Array, sampleRate: number): Float32Array {
  const hail = cutNotes(samples, sampleRate);
  const rough = hail.pieces.map((piece, k) => {
    const envelope = movingAverageAbs(piece, RASP_WINDOW);
    const noise = whiteNoise(piece.length / sampleRate, sampleRate, 1, RASP_SEED + k);
    return piece.map((v, i) => v + RASP_NOISE * envelope[i] * noise[i]);
  });
  return assemble(hail, rough, evenOnsets(rough.length, hail.spacingS));
}

/** The whole clip resampled 1.4x (linear interpolation): the call gets higher and faster. */
export function pitchHigh(samples: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor((samples.length - 1) / PITCH_FACTOR) + 1);
  for (let i = 0; i < out.length; i++) {
    const position = i * PITCH_FACTOR;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, samples.length - 1);
    out[i] = samples[lower] + (samples[upper] - samples[lower]) * (position - lower);
  }
  return out;
}
