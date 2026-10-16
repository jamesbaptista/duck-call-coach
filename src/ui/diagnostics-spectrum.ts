import { powerSpectrum } from "../analysis/fft";

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const SPECTRUM_FLOOR_DB = -200;

export interface AveragedSpectrum {
  /** Power in dB (relative to full scale) for each bin from 0 Hz up to `maxHz`. */
  magnitudeDb: Float32Array;
  binHz: number;
}

/** Mean power spectrum of the whole recording (Hann-windowed frames), 0 Hz up to `maxHz`. */
export function averageSpectrum(pcm: Float32Array, sampleRate: number, maxHz: number): AveragedSpectrum {
  const binHz = sampleRate / FRAME_SIZE;
  const binCount = Math.min(FRAME_SIZE / 2, Math.floor(maxHz / binHz) + 1);
  const power = new Float64Array(binCount);

  let frames = 0;
  for (let start = 0; start + FRAME_SIZE <= pcm.length; start += HOP_SIZE) {
    const spectrum = powerSpectrum(pcm.subarray(start, start + FRAME_SIZE), FRAME_SIZE, "hann");
    for (let bin = 0; bin < binCount; bin++) power[bin] += spectrum[bin];
    frames++;
  }

  const magnitudeDb = new Float32Array(binCount);
  for (let bin = 0; bin < binCount; bin++) {
    const meanPower = frames > 0 ? power[bin] / frames : 0;
    magnitudeDb[bin] = meanPower > 0 ? 10 * Math.log10(meanPower) : SPECTRUM_FLOOR_DB;
  }
  return { magnitudeDb, binHz };
}
