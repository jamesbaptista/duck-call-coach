/** Every analysis parameter, with the values from spec section 4. Times in seconds, frequencies in Hz, levels in dB. */
export const ANALYZER_VERSION = "1.0.0";

export const ANALYSIS = Object.freeze({
  // Pre-filter (spec section 4).
  highPassHz: 200,

  // Frame levels (spec section 4).
  frameS: 0.04,
  hopS: 0.01,

  // Noise floor and note detection (spec section 4).
  floorPercentile: 10,
  onDb: 12,
  offDb: 8,
  mergeGapS: 0.025,
  minNoteS: 0.03,

  // Dips, tails and peak-relative note edges (spec section 4).
  dipDb: 6,
  dipLookaheadS: 0.25,
  tailMaxS: 0.1,
  tailGapS: 0.12,
  tailDropDb: 12,
  edgeDb: 18,

  // Resonance and fundamental (spec section 4).
  resonanceLoHz: 800,
  resonanceHiHz: 4000,
  resonanceSmoothHz: 150,
  liveMinDb: -90,
  fundBandLoHz: 1000,
  fundBandHiHz: 4000,
  fundLagLoHz: 100,
  fundLagHiHz: 700,
  fundMinStrength: 0.25,
  // Short notes are zero-padded to at least this long before the resonance/fundamental FFT (research script).
  minNoteFftS: 0.25,

  // Squeak detection (spec section 4).
  squeakSliceS: 0.03,
  squeakHopS: 0.015,
  squeakLoHz: 2600,
  squeakHalfWidthHz: 150,
  squeakBandLoHz: 300,
  squeakBandHiHz: 6000,
  squeakSkipBelowDb: 20,

  // Spectral flatness band (spec section 4).
  flatLoHz: 300,
  flatHiHz: 6000,

  // Call grouping (spec section 4).
  sequenceGapS: 0.6,
  burstGapS: 0.25,
  // Fewest notes a hail, comeback or chuckle needs before it is scored.
  minCallNotes: 3,
  // Fewest notes a per-note resonance slope is fitted over (research script).
  minSlopeNotes: 3,
  // Notes longer than this count as long quacks (chuckle "longNoteCount").
  longNoteMs: 150,

  // Recording quality gates (spec section 4).
  minSnrDb: 15,
  clipLevel: 0.99,
  clipFraction: 0.005,
});
