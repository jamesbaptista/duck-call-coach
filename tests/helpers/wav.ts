import { readFileSync } from "node:fs";

export interface WavData {
  samples: Float32Array;
  sampleRate: number;
}

const FORMAT_PCM = 1;
const CHUNK_HEADER_BYTES = 8;
const FMT_MIN_BYTES = 16;

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Test-only reader for 16-bit PCM mono WAV files. Throws on anything else. */
export function readWav(path: string): WavData {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 12 || tagAt(view, 0) !== "RIFF" || tagAt(view, 8) !== "WAVE") {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }

  let sampleRate = 0;
  let hasFormat = false;
  let offset = 12;
  while (offset + CHUNK_HEADER_BYTES <= bytes.byteLength) {
    const id = tagAt(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + CHUNK_HEADER_BYTES;

    if (id === "fmt ") {
      if (size < FMT_MIN_BYTES || body + FMT_MIN_BYTES > bytes.byteLength) {
        throw new Error(`${path}: fmt chunk is too short`);
      }
      const formatCode = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      if (formatCode !== FORMAT_PCM) throw new Error(`${path}: expected 16-bit PCM, got format code ${formatCode}`);
      if (channels !== 1) throw new Error(`${path}: expected mono, got ${channels} channels`);
      if (bitsPerSample !== 16) throw new Error(`${path}: expected 16-bit samples, got ${bitsPerSample}-bit`);
      sampleRate = view.getUint32(body + 4, true);
      hasFormat = true;
    } else if (id === "data") {
      if (!hasFormat) throw new Error(`${path}: data chunk comes before the fmt chunk`);
      if (body + size > bytes.byteLength) throw new Error(`${path}: data chunk runs past the end of the file`);
      const samples = new Float32Array(size >> 1);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = view.getInt16(body + i * 2, true) / 32768;
      }
      return { samples, sampleRate };
    }

    offset = body + size + (size & 1); // chunks are padded to an even size
  }

  throw new Error(hasFormat ? `${path}: no data chunk found` : `${path}: no fmt chunk found`);
}
