import { ANALYSIS } from "../config/analysis";

const RMS_EPSILON = 1e-9;

/** RMS level in dB for each analysis frame (40 ms frames, 10 ms hop). */
export function frameLevelsDb(x: Float32Array, sampleRate: number): Float32Array {
  const frame = Math.round(ANALYSIS.frameS * sampleRate);
  const hop = Math.round(ANALYSIS.hopS * sampleRate);
  const count = x.length < frame ? 0 : Math.floor((x.length - frame) / hop) + 1;
  const levels = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    let sumSquares = 0;
    for (let i = start; i < start + frame; i++) sumSquares += x[i] * x[i];
    levels[f] = 20 * Math.log10(Math.sqrt(sumSquares / frame) + RMS_EPSILON);
  }
  return levels;
}
