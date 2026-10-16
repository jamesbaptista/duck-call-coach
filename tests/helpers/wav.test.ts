import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readWav } from "./wav";

const scratchDir = mkdtempSync(join(tmpdir(), "wav-test-"));
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

function writeScratch(name: string, bytes: Uint8Array): string {
  const path = join(scratchDir, name);
  writeFileSync(path, bytes);
  return path;
}

/** Build a minimal WAV; `extraChunk` is inserted before `fmt ` to exercise the chunk walk. */
function buildWav(options: {
  format?: number;
  channels?: number;
  bits?: number;
  samples?: number[];
  extraChunk?: Uint8Array;
  omitData?: boolean;
}): Uint8Array {
  const { format = 1, channels = 1, bits = 16, samples = [0, 16384, -16384], extraChunk } = options;
  const sampleRate = 44100;
  const dataBytes = samples.length * 2;
  const chunks: number[] = [];
  const u16 = (v: number) => chunks.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const tag = (s: string) => chunks.push(...[...s].map((c) => c.charCodeAt(0)));

  if (extraChunk) {
    tag("LIST");
    u32(extraChunk.length);
    chunks.push(...extraChunk);
    if (extraChunk.length % 2 === 1) chunks.push(0);
  }
  tag("fmt ");
  u32(16);
  u16(format);
  u16(channels);
  u32(sampleRate);
  u32((sampleRate * channels * bits) / 8);
  u16((channels * bits) / 8);
  u16(bits);
  if (!options.omitData) {
    tag("data");
    u32(dataBytes);
    for (const s of samples) u16(s & 0xffff);
  }
  const header: number[] = [];
  const push = (...b: number[]) => header.push(...b);
  push(...[..."RIFF"].map((c) => c.charCodeAt(0)));
  const size = 4 + chunks.length;
  push(size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff);
  push(...[..."WAVE"].map((c) => c.charCodeAt(0)));
  return Uint8Array.from([...header, ...chunks]);
}

describe("readWav", () => {
  it("reads the hail fixture at its original rate with samples in [-1, 1]", () => {
    const { samples, sampleRate } = readWav("tests/fixtures/hail_a.wav");
    expect(sampleRate).toBe(48000);
    expect(Math.abs(samples.length - 2.8 * 48000)).toBeLessThanOrEqual(1);
    expect(samples.every((s) => s >= -1 && s <= 1)).toBe(true);
    expect(samples.some((s) => Math.abs(s) > 0.001)).toBe(true);
  });

  it.each([
    ["chuckle_a.wav", 48000, 6.0],
    ["quacks_4.wav", 44100, 1.6],
    ["steady_quacks.wav", 44100, 9.6],
    ["hail_b.wav", 44100, 1.7],
  ])("reads fixture %s at %i Hz for %f s", (name, rate, seconds) => {
    const { samples, sampleRate } = readWav(`tests/fixtures/${name}`);
    expect(sampleRate).toBe(rate);
    expect(Math.abs(samples.length - seconds * rate)).toBeLessThanOrEqual(1);
  });

  it("scales 16-bit samples to floats", () => {
    const path = writeScratch("ok.wav", buildWav({ samples: [0, 16384, -16384, -32768] }));
    const { samples, sampleRate } = readWav(path);
    expect(sampleRate).toBe(44100);
    expect(Array.from(samples)).toEqual([0, 0.5, -0.5, -1]);
  });

  it("skips an odd-sized chunk and its padding byte", () => {
    const path = writeScratch("odd.wav", buildWav({ extraChunk: Uint8Array.of(1, 2, 3) }));
    expect(readWav(path).samples.length).toBe(3);
  });

  it("throws on a file that is not a WAV", () => {
    const path = writeScratch("junk.wav", Uint8Array.from({ length: 64 }, (_, i) => i * 7));
    expect(() => readWav(path)).toThrow(/not a RIFF\/WAVE/);
  });

  it("throws on a truncated file", () => {
    expect(() => readWav(writeScratch("tiny.wav", Uint8Array.of(1, 2, 3)))).toThrow(/not a RIFF\/WAVE/);
  });

  it("throws on non-PCM format, stereo, or other bit depths", () => {
    expect(() => readWav(writeScratch("float.wav", buildWav({ format: 3 })))).toThrow(/16-bit PCM/);
    expect(() => readWav(writeScratch("stereo.wav", buildWav({ channels: 2 })))).toThrow(/mono/);
    expect(() => readWav(writeScratch("bits.wav", buildWav({ bits: 24 })))).toThrow(/16-bit/);
  });

  it("throws when the data chunk is missing", () => {
    expect(() => readWav(writeScratch("nodata.wav", buildWav({ omitData: true })))).toThrow(/data chunk/);
  });
});
