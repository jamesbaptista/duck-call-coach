import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/analyze";
import type { CallMeasurements } from "../../src/analysis/types";
import { dragging, noFade, pitchHigh, raspy, rushed, squeak, tooMany, uneven } from "../helpers/plant";
import { readWav } from "../helpers/wav";

/**
 * The hail targets from the spec. scoring/targets.json does not exist yet (Task 11); these constants mirror
 * the spec's hail ranges and should be read from it once it does.
 */
const HAIL = {
  spacingMs: { min: 230, max: 370 },
  spacingCvMax: 0.15,
  fadeDbMin: 4,
  noteCount: { min: 4, max: 10 },
  maxSqueakShareBelow: 0.8,
  resonanceHz: { min: 1500, max: 2400 },
};

/** Raspy: the planted flatness must be more than this many times the clean flatness (flatness has no range; it is relative). */
const RASPY_FLATNESS_RATIO = 1.4;

const FIXTURES = ["hail_a", "hail_b"]; // hail_c is license-excluded

function measure(samples: Float32Array, sampleRate: number): CallMeasurements {
  const result = analyze(samples, sampleRate, "hail");
  expect(result.quality, "the planted clip must pass the quality gate").toBeNull();
  expect(result.measurements).not.toBeNull();
  return result.measurements as CallMeasurements;
}

function present(value: number | null): number {
  expect(value).not.toBeNull();
  return value as number;
}

interface Mistake {
  name: string;
  plant: (samples: Float32Array, sampleRate: number) => Float32Array;
  /** The clean hail's value for the measure under test sits inside its hail range. */
  cleanIsInRange: (clean: CallMeasurements) => void;
  /** The planted clip's value has crossed the boundary of that range. */
  isCaught: (planted: CallMeasurements, clean: CallMeasurements) => void;
}

const MISTAKES: Mistake[] = [
  {
    name: "rushing",
    plant: rushed,
    cleanIsInRange: (clean) => {
      expect(present(clean.spacingMs)).toBeGreaterThanOrEqual(HAIL.spacingMs.min);
      expect(present(clean.spacingMs)).toBeLessThanOrEqual(HAIL.spacingMs.max);
    },
    isCaught: (planted) => expect(present(planted.spacingMs)).toBeLessThan(HAIL.spacingMs.min),
  },
  {
    name: "dragging",
    plant: dragging,
    cleanIsInRange: (clean) => {
      expect(present(clean.spacingMs)).toBeGreaterThanOrEqual(HAIL.spacingMs.min);
      expect(present(clean.spacingMs)).toBeLessThanOrEqual(HAIL.spacingMs.max);
    },
    isCaught: (planted) => expect(present(planted.spacingMs)).toBeGreaterThan(HAIL.spacingMs.max),
  },
  {
    name: "uneven rhythm",
    plant: uneven,
    cleanIsInRange: (clean) => expect(present(clean.spacingCv)).toBeLessThanOrEqual(HAIL.spacingCvMax),
    isCaught: (planted) => expect(present(planted.spacingCv)).toBeGreaterThan(HAIL.spacingCvMax),
  },
  {
    name: "no fade",
    plant: noFade,
    cleanIsInRange: (clean) => expect(clean.fadeDb).toBeGreaterThanOrEqual(HAIL.fadeDbMin),
    isCaught: (planted) => expect(planted.fadeDb).toBeLessThan(HAIL.fadeDbMin),
  },
  {
    name: "too many notes",
    plant: tooMany,
    cleanIsInRange: (clean) => {
      expect(clean.noteCount).toBeGreaterThanOrEqual(HAIL.noteCount.min);
      expect(clean.noteCount).toBeLessThanOrEqual(HAIL.noteCount.max);
    },
    isCaught: (planted) => expect(planted.noteCount).toBeGreaterThan(HAIL.noteCount.max),
  },
  {
    name: "a squeak",
    plant: squeak,
    cleanIsInRange: (clean) => expect(clean.maxSqueakShare).toBeLessThan(HAIL.maxSqueakShareBelow),
    isCaught: (planted) => expect(planted.maxSqueakShare).toBeGreaterThanOrEqual(HAIL.maxSqueakShareBelow),
  },
  {
    name: "a raspy tone",
    plant: raspy,
    cleanIsInRange: (clean) => expect(clean.flatness).toBeGreaterThan(0),
    isCaught: (planted, clean) => expect(planted.flatness).toBeGreaterThan(RASPY_FLATNESS_RATIO * clean.flatness),
  },
  {
    name: "pitch too high",
    plant: pitchHigh,
    cleanIsInRange: (clean) => {
      expect(clean.resonanceHz).toBeGreaterThanOrEqual(HAIL.resonanceHz.min);
      expect(clean.resonanceHz).toBeLessThanOrEqual(HAIL.resonanceHz.max);
    },
    isCaught: (planted) => expect(planted.resonanceHz).toBeGreaterThan(HAIL.resonanceHz.max),
  },
];

describe.each(FIXTURES)("planted mistakes in %s", (fixture) => {
  const { samples, sampleRate } = readWav(`tests/fixtures/${fixture}.wav`);
  const clean = measure(samples, sampleRate);

  for (const { name, plant, cleanIsInRange, isCaught } of MISTAKES) {
    it(`catches ${name} on ${fixture}`, () => {
      cleanIsInRange(clean);
      isCaught(measure(plant(samples, sampleRate), sampleRate), clean);
    });
  }
});
