import { ANALYSIS } from "../config/analysis";

/** Q factors of the two second-order sections that make a 4th-order Butterworth. */
const BUTTERWORTH_4_Q = [0.5412, 1.3066] as const;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook high-pass biquad, coefficients normalised by a0. */
function highPassBiquad(cutoffHz: number, sampleRate: number, q: number): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Direct form II transposed, in place. */
function runBiquad(x: Float64Array, { b0, b1, b2, a1, a2 }: Biquad): void {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const input = x[i];
    const output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    x[i] = output;
  }
}

function runCascade(x: Float64Array, sections: Biquad[]): void {
  for (const section of sections) runBiquad(x, section);
}

/**
 * Zero-phase 4th-order Butterworth high-pass: two cascaded biquads run forward, then
 * backward. Like scipy's `sosfiltfilt` the magnitude response is squared (-6 dB at the cutoff).
 */
export function highPass(x: Float32Array, sampleRate: number, cutoffHz: number = ANALYSIS.highPassHz): Float32Array {
  const sections = BUTTERWORTH_4_Q.map((q) => highPassBiquad(cutoffHz, sampleRate, q));
  const work = Float64Array.from(x);
  runCascade(work, sections);
  work.reverse();
  runCascade(work, sections);
  work.reverse();
  return Float32Array.from(work);
}
