import type { AnalysisResult, CallMeasurements, CallType, Note, QualityIssue } from "../analysis/types";
import { CALL_TYPES, MEASURE_KEYS, SUB_SCORES, type MeasureScore, type Scores, type SubScore } from "../scoring/types";
import { decodeBase64, decodedByteLength } from "./base64";
import type { AttemptRecord, ReferenceRecord } from "./db";

/**
 * Reading a backup file. The file is untrusted input: nothing here is cast, every field is checked, and
 * the records returned are rebuilt field by field, so unknown keys never reach the database.
 */

export const BACKUP_FORMAT = "duck-call-coach-backup";
export const BACKUP_VERSION = 1;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_BACKUP_CHARS = 500 * 1024 * 1024;
const MAX_ID_LENGTH = 64;

/** Thrown for any problem with a backup file; the message is plain English and safe to show. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export interface BackupData {
  exportedAt: string;
  attempts: AttemptRecord[];
  references: ReferenceRecord[];
}

type Raw = Record<string, unknown>;

/** Where a value sits in the file, for error messages: "Attempt 3: analysis.notes[1].peakDb". */
interface Where {
  label: string;
  path: string;
}

function fail(at: Where, problem: string): never {
  throw new BackupError(`${at.path === "" ? at.label : `${at.label}: ${at.path}`} ${problem}`);
}

function field(at: Where, key: string): Where {
  return { label: at.label, path: at.path === "" ? key : `${at.path}.${key}` };
}

function item(at: Where, index: number): Where {
  return { label: at.label, path: `${at.path}[${index}]` };
}

function readObject(value: unknown, at: Where): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(at, "must be an object.");
  return value as Raw;
}

function readArray(value: unknown, at: Where): unknown[] {
  if (!Array.isArray(value)) fail(at, "must be a list.");
  return value;
}

function readString(value: unknown, at: Where): string {
  if (typeof value !== "string") fail(at, "must be text.");
  return value;
}

function readNumber(value: unknown, at: Where): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(at, "must be a number.");
  return value;
}

function readBoolean(value: unknown, at: Where): boolean {
  if (typeof value !== "boolean") fail(at, "must be true or false.");
  return value;
}

function readNullable<T>(value: unknown, at: Where, read: (value: unknown, at: Where) => T): T | null {
  return value === null ? null : read(value, at);
}

function readOneOf<T extends string>(value: unknown, allowed: readonly T[], at: Where): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(at, `must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

const QUALITY_ISSUE_FLAGS: Record<QualityIssue, true> = {
  clipped: true,
  too_quiet: true,
  no_notes: true,
  too_few_notes: true,
};
const QUALITY_ISSUES = Object.keys(QUALITY_ISSUE_FLAGS) as QualityIssue[];

/** Every call measurement, and whether it can be null; the Record type makes the compiler flag a missing one. */
const MEASUREMENT_NULLABLE: Record<keyof CallMeasurements, boolean> = {
  noteCount: false,
  spacingMs: true,
  spacingCv: true,
  burstSpacingMs: true,
  firstNoteMs: false,
  lastNoteMs: false,
  medianNoteMs: false,
  lastFirstRatio: true,
  loudestIndex: false,
  fadeDb: false,
  resonanceHz: false,
  resonanceSlopeHzPerNote: true,
  flatness: false,
  maxSqueakShare: false,
  longNoteCount: false,
  snrDb: false,
};

function readMeasurements(value: unknown, at: Where): CallMeasurements {
  const raw = readObject(value, at);
  const result: Record<string, number | null> = {};
  for (const [key, nullable] of Object.entries(MEASUREMENT_NULLABLE)) {
    const where = field(at, key);
    result[key] = nullable ? readNullable(raw[key], where, readNumber) : readNumber(raw[key], where);
  }
  return result as unknown as CallMeasurements;
}

function readNote(value: unknown, at: Where): Note {
  const raw = readObject(value, at);
  return {
    startS: readNumber(raw.startS, field(at, "startS")),
    endS: readNumber(raw.endS, field(at, "endS")),
    durationMs: readNumber(raw.durationMs, field(at, "durationMs")),
    peakDb: readNumber(raw.peakDb, field(at, "peakDb")),
    resonanceHz: readNumber(raw.resonanceHz, field(at, "resonanceHz")),
    fundamentalHz: readNullable(raw.fundamentalHz, field(at, "fundamentalHz"), readNumber),
    squeakShare: readNullable(raw.squeakShare, field(at, "squeakShare"), readNumber),
    flatness: readNumber(raw.flatness, field(at, "flatness")),
  };
}

function readNotes(value: unknown, at: Where): Note[] {
  return readArray(value, at).map((note, i) => readNote(note, item(at, i)));
}

function readAnalysis(value: unknown, at: Where): AnalysisResult {
  const raw = readObject(value, at);
  return {
    callType: readOneOf(raw.callType, CALL_TYPES, field(at, "callType")),
    analyzerVersion: readString(raw.analyzerVersion, field(at, "analyzerVersion")),
    noiseFloorDb: readNumber(raw.noiseFloorDb, field(at, "noiseFloorDb")),
    notes: readNotes(raw.notes, field(at, "notes")),
    measurements: readNullable(raw.measurements, field(at, "measurements"), readMeasurements),
    quality:
      raw.quality === null ? null : readOneOf(raw.quality, QUALITY_ISSUES, field(at, "quality")),
  };
}

function readMeasureScore(value: unknown, at: Where): MeasureScore {
  const raw = readObject(value, at);
  return {
    key: readOneOf(raw.key, MEASURE_KEYS, field(at, "key")),
    sub: readOneOf(raw.sub, SUB_SCORES, field(at, "sub")),
    value: readNullable(raw.value, field(at, "value"), readNumber),
    lo: readNumber(raw.lo, field(at, "lo")),
    hi: readNumber(raw.hi, field(at, "hi")),
    score: readNullable(raw.score, field(at, "score"), readNumber),
    weightedLoss: readNumber(raw.weightedLoss, field(at, "weightedLoss")),
  };
}

function readScores(value: unknown, at: Where): Scores {
  const raw = readObject(value, at);
  const subsAt = field(at, "subs");
  const rawSubs = readObject(raw.subs, subsAt);
  const subs = {} as Record<SubScore, number | null>;
  for (const sub of SUB_SCORES) subs[sub] = readNullable(rawSubs[sub], field(subsAt, sub), readNumber);
  const measuresAt = field(at, "measures");
  return {
    overall: readNumber(raw.overall, field(at, "overall")),
    subs,
    measures: readArray(raw.measures, measuresAt).map((m, i) => readMeasureScore(m, item(measuresAt, i))),
  };
}

function readStringList(value: unknown, at: Where): string[] {
  return readArray(value, at).map((text, i) => readString(text, item(at, i)));
}

function readTips(value: unknown, at: Where): AttemptRecord["tips"] {
  const raw = readObject(value, at);
  return {
    problems: readStringList(raw.problems, field(at, "problems")),
    positive: readNullable(raw.positive, field(at, "positive"), readString),
  };
}

function readId(value: unknown, at: Where): string {
  const id = readString(value, at);
  if (id.length < 1 || id.length > MAX_ID_LENGTH) fail(at, `must be 1 to ${MAX_ID_LENGTH} characters long.`);
  return id;
}

function readMimeType(value: unknown, at: Where): string {
  const mimeType = readString(value, at);
  if (!mimeType.startsWith("audio/")) fail(at, 'must be an audio type, starting with "audio/".');
  return mimeType;
}

/** Decodes base64 audio into a Blob. Empty text is allowed: it is how a record whose recording was lost is exported. */
function readAudio(value: unknown, mimeType: string, at: Where): Blob {
  const text = readString(value, at);
  const size = decodedByteLength(text);
  if (size === null) fail(at, "is not valid base64.");
  if (size > MAX_AUDIO_BYTES) fail(at, `is larger than ${MAX_AUDIO_BYTES / (1024 * 1024)} MB.`);
  const bytes = decodeBase64(text);
  if (bytes === null) fail(at, "is not valid base64.");
  return new Blob([bytes as BlobPart], { type: mimeType });
}

function readAttempt(value: unknown, at: Where): AttemptRecord {
  const raw = readObject(value, at);
  const mimeType = readMimeType(raw.mimeType, field(at, "mimeType"));
  return {
    id: readId(raw.id, field(at, "id")),
    callType: readOneOf<CallType>(raw.callType, CALL_TYPES, field(at, "callType")),
    createdAt: readNumber(raw.createdAt, field(at, "createdAt")),
    analyzerVersion: readString(raw.analyzerVersion, field(at, "analyzerVersion")),
    analysis: readAnalysis(raw.analysis, field(at, "analysis")),
    scores: readNullable(raw.scores, field(at, "scores"), readScores),
    tips: readTips(raw.tips, field(at, "tips")),
    audio: readAudio(raw.audio, mimeType, field(at, "audio")),
    mimeType,
    durationMs: readNumber(raw.durationMs, field(at, "durationMs")),
    processingOff: readBoolean(raw.processingOff, field(at, "processingOff")),
    targetSource: readOneOf(raw.targetSource, ["builtin", "reference"], field(at, "targetSource")),
  };
}

function readReference(value: unknown, at: Where): ReferenceRecord {
  const raw = readObject(value, at);
  const mimeType = readMimeType(raw.mimeType, field(at, "mimeType"));
  return {
    id: readId(raw.id, field(at, "id")),
    callType: readOneOf<CallType>(raw.callType, CALL_TYPES, field(at, "callType")),
    name: readString(raw.name, field(at, "name")),
    createdAt: readNumber(raw.createdAt, field(at, "createdAt")),
    audio: readAudio(raw.audio, mimeType, field(at, "audio")),
    mimeType,
    measurements: readMeasurements(raw.measurements, field(at, "measurements")),
    notes: readNotes(raw.notes, field(at, "notes")),
    active: readBoolean(raw.active, field(at, "active")),
  };
}

/** Reads a list of records, rejecting an id that appears twice. */
function readRecords<T extends { id: string }>(
  value: unknown,
  listName: string,
  noun: string,
  read: (value: unknown, at: Where) => T,
): T[] {
  const list = readArray(value, { label: "The backup", path: listName });
  const firstIndexOfId = new Map<string, number>();
  return list.map((raw, i) => {
    const at: Where = { label: `${noun} ${i + 1}`, path: "" };
    const record = read(raw, at);
    const first = firstIndexOfId.get(record.id);
    if (first !== undefined) fail(at, `has the same id as ${noun.toLowerCase()} ${first + 1}.`);
    firstIndexOfId.set(record.id, i);
    return record;
  });
}

/** Validates a parsed backup file and returns its records, with audio decoded to Blobs. Throws BackupError. */
export function readBackup(raw: unknown): BackupData {
  const top: Where = { label: "The backup", path: "" };
  const file = readObject(raw, { label: "This file", path: "" });
  if (file.format !== BACKUP_FORMAT) {
    throw new BackupError(`This is not a Duck Call Coach backup (its format should be "${BACKUP_FORMAT}").`);
  }
  if (file.version !== BACKUP_VERSION) {
    throw new BackupError(`This backup was made by a different version of the app. Only version ${BACKUP_VERSION} can be restored.`);
  }
  return {
    exportedAt: readString(file.exportedAt, field(top, "exportedAt")),
    attempts: readRecords(file.attempts, "attempts", "Attempt", readAttempt),
    references: readRecords(file.references, "references", "Reference", readReference),
  };
}
