import type { Note } from "../../analysis/types";
import type { CallTargets, MeasureKey } from "../../scoring/types";

/** One note of the target outline the Results chart draws behind the attempt. Times in seconds, level in dB. */
export interface ShapeNote {
  startS: number;
  durationMs: number;
  levelDb: number;
  /** Only a reference has real resonance values; the built-in shape leaves this out. */
  resonanceHz?: number;
}

/** The note sequences (hail, comeback): how many notes are drawn and how long the first one is. */
const SEQUENCE_SHAPES = {
  hail: { noteCount: 6, firstNoteMs: 250 },
  comeback: { noteCount: 7, firstNoteMs: 200 },
} as const;
/** The last note is this fraction of the first one's length; lengths shrink linearly in between. */
const LAST_FIRST_RATIO = 0.5;
/** From the second note on, the levels fall evenly to this many dB below the first note. */
const FADE_DB = 8;

const QUACK_NOTE_MS = 280;

const CHUCKLE_SHAPE = { bursts: 3, notesPerBurst: 4, noteMs: 60, betweenBurstsMs: 400 } as const;

const MS_PER_S = 1000;

/** The middle of a measure's target range, for example the hail's 230-370 ms spacing gives 300 ms. */
function midRange(t: CallTargets, key: MeasureKey): number {
  const measure = t.measures.find((m) => m.key === key);
  if (!measure) throw new Error(`The ${t.callType} targets have no ${key} range to draw the target from.`);
  return (measure.lo + measure.hi) / 2;
}

function sequenceShape(t: CallTargets, shape: { noteCount: number; firstNoteMs: number }): ShapeNote[] {
  const spacingS = midRange(t, "spacingMs") / MS_PER_S;
  const last = shape.noteCount - 1;
  return Array.from({ length: shape.noteCount }, (_, i) => ({
    startS: i * spacingS,
    durationMs: shape.firstNoteMs * (1 - ((1 - LAST_FIRST_RATIO) * i) / last),
    levelDb: i <= 1 ? 0 : (-FADE_DB * (i - 1)) / (last - 1),
  }));
}

function chuckleShape(t: CallTargets): ShapeNote[] {
  const spacingS = midRange(t, "burstSpacingMs") / MS_PER_S;
  const burstLengthS = (CHUCKLE_SHAPE.notesPerBurst - 1) * spacingS + CHUCKLE_SHAPE.betweenBurstsMs / MS_PER_S;
  const notes: ShapeNote[] = [];
  for (let burst = 0; burst < CHUCKLE_SHAPE.bursts; burst++) {
    for (let note = 0; note < CHUCKLE_SHAPE.notesPerBurst; note++) {
      notes.push({ startS: burst * burstLengthS + note * spacingS, durationMs: CHUCKLE_SHAPE.noteMs, levelDb: 0 });
    }
  }
  return notes;
}

/** An idealised hen call drawn from the built-in targets, for the Results chart. */
export function builtInShape(t: CallTargets): ShapeNote[] {
  switch (t.callType) {
    case "quack":
      return [{ startS: 0, durationMs: QUACK_NOTE_MS, levelDb: 0 }];
    case "chuckle":
      return chuckleShape(t);
    default:
      return sequenceShape(t, SEQUENCE_SHAPES[t.callType]);
  }
}

/** The user's reference recording, note for note. */
export function referenceShape(ref: Note[]): ShapeNote[] {
  return ref.map((note) => ({
    startS: note.startS,
    durationMs: note.durationMs,
    levelDb: note.peakDb,
    resonanceHz: note.resonanceHz,
  }));
}
