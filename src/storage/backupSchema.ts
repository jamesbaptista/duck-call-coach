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

/** Most records one list may hold, and most entries in the lists inside a record. Checked before reading the entries. */
export const MAX_RECORDS_PER_LIST = 10_000;
export const MAX_NOTES = 1_000;
export const MAX_SCORE_MEASURES = 64;
export const MAX_TIPS = 50;

/** Any measured value, score or time must stay within this, so later arithmetic on it cannot overflow to Infinity. */
export const MAX_MAGNITUDE = 1e9;
/** Score ranges (lo, hi) are built from a measured value times at most 1.2 plus a margin, so they get headroom. */
const MAX_RANGE_MAGNITUDE = 1e10;
/** The latest time a JavaScript Date can hold, in milliseconds. */
const MAX_TIMESTAMP_MS = 8.64e15;
const MAX_SCORE = 100;

export const MAX_ID_LENGTH = 64;
export const MAX_NAME_LENGTH = 60;
export const MAX_TIP_LENGTH = 500;
const MAX_ANALYZER_VERSION_LENGTH = 32;
const MAX_MIME_TYPE_LENGTH = 100;
const MAX_EXPORTED_AT_LENGTH = 40;

/** Ids end up in URL routes, so they are limited to characters that need no escaping. */
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_AUDIO_MIME_TYPE = /^audio\/[a-z0-9.+-]+(;.*)?$/;

/** True for a media type a backup accepts for a recording, such as "audio/webm;codecs=opus". */
export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.length <= MAX_MIME_TYPE_LENGTH && VALID_AUDIO_MIME_TYPE.test(mimeType);
}

/** Which record of the file a problem is in: its list and its place in that list (from 0). */
export interface RecordProblem {
  list: "attempts" | "references";
  index: number;
  /** The field inside the record, such as "analysis.notes[1].peakDb"; empty for the record as a whole. */
  path: string;
  /** What is wrong, as the end of a sentence: "must be a number." */
  problem: string;
}

/** Thrown for any problem with a backup file; the message is plain English and safe to show. */
export class BackupError extends Error {
  constructor(
    message: string,
    /** Set when the problem is inside one record, so the message can be reworded to name it. */
    readonly record?: RecordProblem,
  ) {
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
  /** The record the value belongs to, if any. */
  record?: Pick<RecordProblem, "list" | "index">;
}

/** "Attempt 3: analysis.notes[1].peakDb must be a number.", or "Attempt 3 must be an object." for the whole record. */
export function problemText(label: string, path: string, problem: string): string {
  return `${path === "" ? label : `${label}: ${path}`} ${problem}`;
}

function fail(at: Where, problem: string): never {
  const record = at.record && { ...at.record, path: at.path, problem };
  throw new BackupError(problemText(at.label, at.path, problem), record);
}

function field(at: Where, key: string): Where {
  return { ...at, path: at.path === "" ? key : `${at.path}.${key}` };
}

function item(at: Where, index: number): Where {
  return { ...at, path: `${at.path}[${index}]` };
}

function readObject(value: unknown, at: Where): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(at, "must be an object.");
  return value as Raw;
}

/** The length is checked here, before the caller looks at a single entry. */
function readArray(value: unknown, at: Where, maxLength: number): unknown[] {
  if (!Array.isArray(value)) fail(at, "must be a list.");
  if (value.length > maxLength) fail(at, `has too many entries (the limit is ${maxLength}).`);
  return value;
}

function readString(value: unknown, at: Where, maxLength: number): string {
  if (typeof value !== "string") fail(at, "must be text.");
  if (value.length > maxLength) fail(at, `is too long (the limit is ${maxLength} characters).`);
  return value;
}

function readNumber(value: unknown, at: Where, limit: number = MAX_MAGNITUDE): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(at, "must be a number.");
  if (Math.abs(value) > limit) fail(at, `must be between -${limit} and ${limit}.`);
  return value;
}

function readRangeBound(value: unknown, at: Where): number {
  return readNumber(value, at, MAX_RANGE_MAGNITUDE);
}

/** A whole number of 0 or more, such as a count or an index. */
function readCount(value: unknown, at: Where): number {
  const count = readNumber(value, at);
  if (!Number.isInteger(count) || count < 0) fail(at, "must be a whole number, 0 or more.");
  return count;
}

/** A length of time: not negative, fractions allowed (a recording's length is not a whole number of ms). */
function readNonNegative(value: unknown, at: Where): number {
  const number = readNumber(value, at);
  if (number < 0) fail(at, "must not be negative.");
  return number;
}

function readScore(value: unknown, at: Where): number {
  const score = readNumber(value, at);
  if (score < 0 || score > MAX_SCORE) fail(at, `must be between 0 and ${MAX_SCORE}.`);
  return score;
}

/** Milliseconds since 1970, as Date.now() gives them: a whole number that a Date can represent. */
function readTimestamp(value: unknown, at: Where): number {
  const time = readNumber(value, at, MAX_TIMESTAMP_MS);
  if (!Number.isInteger(time) || time < 0) fail(at, "must be a whole number of milliseconds, 0 or more.");
  return time;
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

/**
 * Every call measurement and what it holds: a whole-number "count", any "number", or an "optional" number that can
 * be null. The Record type makes the compiler flag a missing one.
 */
const MEASUREMENT_KIND: Record<keyof CallMeasurements, "count" | "number" | "optional"> = {
  noteCount: "count",
  spacingMs: "optional",
  spacingCv: "optional",
  burstSpacingMs: "optional",
  firstNoteMs: "number",
  lastNoteMs: "number",
  medianNoteMs: "number",
  lastFirstRatio: "optional",
  loudestIndex: "count",
  fadeDb: "number",
  resonanceHz: "number",
  resonanceSlopeHzPerNote: "optional",
  flatness: "number",
  maxSqueakShare: "number",
  longNoteCount: "count",
  snrDb: "number",
};

function readMeasurements(value: unknown, at: Where): CallMeasurements {
  const raw = readObject(value, at);
  const result: Record<string, number | null> = {};
  for (const [key, kind] of Object.entries(MEASUREMENT_KIND)) {
    const where = field(at, key);
    if (kind === "count") result[key] = readCount(raw[key], where);
    else if (kind === "optional") result[key] = readNullable(raw[key], where, readNumber);
    else result[key] = readNumber(raw[key], where);
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
  return readArray(value, at, MAX_NOTES).map((note, i) => readNote(note, item(at, i)));
}

function readVersion(value: unknown, at: Where): string {
  return readString(value, at, MAX_ANALYZER_VERSION_LENGTH);
}

function readAnalysis(value: unknown, at: Where): AnalysisResult {
  const raw = readObject(value, at);
  return {
    callType: readOneOf(raw.callType, CALL_TYPES, field(at, "callType")),
    analyzerVersion: readVersion(raw.analyzerVersion, field(at, "analyzerVersion")),
    noiseFloorDb: readNumber(raw.noiseFloorDb, field(at, "noiseFloorDb")),
    notes: readNotes(raw.notes, field(at, "notes")),
    measurements: readNullable(raw.measurements, field(at, "measurements"), readMeasurements),
    quality: raw.quality === null ? null : readOneOf(raw.quality, QUALITY_ISSUES, field(at, "quality")),
  };
}

function readMeasureScore(value: unknown, at: Where): MeasureScore {
  const raw = readObject(value, at);
  return {
    key: readOneOf(raw.key, MEASURE_KEYS, field(at, "key")),
    sub: readOneOf(raw.sub, SUB_SCORES, field(at, "sub")),
    value: readNullable(raw.value, field(at, "value"), readNumber),
    lo: readRangeBound(raw.lo, field(at, "lo")),
    hi: readRangeBound(raw.hi, field(at, "hi")),
    score: readNullable(raw.score, field(at, "score"), readScore),
    weightedLoss: readNumber(raw.weightedLoss, field(at, "weightedLoss")),
  };
}

function readScores(value: unknown, at: Where): Scores {
  const raw = readObject(value, at);
  const subsAt = field(at, "subs");
  const rawSubs = readObject(raw.subs, subsAt);
  const subs = {} as Record<SubScore, number | null>;
  for (const sub of SUB_SCORES) subs[sub] = readNullable(rawSubs[sub], field(subsAt, sub), readScore);
  const measuresAt = field(at, "measures");
  return {
    overall: readScore(raw.overall, field(at, "overall")),
    subs,
    measures: readArray(raw.measures, measuresAt, MAX_SCORE_MEASURES).map((m, i) =>
      readMeasureScore(m, item(measuresAt, i)),
    ),
  };
}

function readTip(value: unknown, at: Where): string {
  return readString(value, at, MAX_TIP_LENGTH);
}

function readTipList(value: unknown, at: Where): string[] {
  return readArray(value, at, MAX_TIPS).map((tip, i) => readTip(tip, item(at, i)));
}

function readTips(value: unknown, at: Where): AttemptRecord["tips"] {
  const raw = readObject(value, at);
  return {
    problems: readTipList(raw.problems, field(at, "problems")),
    positive: readNullable(raw.positive, field(at, "positive"), readTip),
  };
}

function readId(value: unknown, at: Where): string {
  const id = readString(value, at, MAX_ID_LENGTH);
  if (!VALID_ID.test(id)) fail(at, `must be 1 to ${MAX_ID_LENGTH} letters, digits, dashes or underscores.`);
  return id;
}

function readMimeType(value: unknown, at: Where): string {
  const mimeType = readString(value, at, MAX_MIME_TYPE_LENGTH);
  if (!VALID_AUDIO_MIME_TYPE.test(mimeType)) fail(at, 'must be an audio type such as "audio/webm".');
  return mimeType;
}

function readDateText(value: unknown, at: Where): string {
  const text = readString(value, at, MAX_EXPORTED_AT_LENGTH);
  if (Number.isNaN(Date.parse(text))) fail(at, "must be a date.");
  return text;
}

/** Decodes base64 audio into a Blob. Empty text is allowed: it is how a record whose recording was lost is exported. */
function readAudio(value: unknown, mimeType: string, at: Where): Blob {
  // The whole file is already capped, so the text is not capped again here; the decoded size is checked below.
  const text = readString(value, at, MAX_BACKUP_CHARS);
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
    createdAt: readTimestamp(raw.createdAt, field(at, "createdAt")),
    analyzerVersion: readVersion(raw.analyzerVersion, field(at, "analyzerVersion")),
    analysis: readAnalysis(raw.analysis, field(at, "analysis")),
    scores: readNullable(raw.scores, field(at, "scores"), readScores),
    tips: readTips(raw.tips, field(at, "tips")),
    audio: readAudio(raw.audio, mimeType, field(at, "audio")),
    mimeType,
    durationMs: readNonNegative(raw.durationMs, field(at, "durationMs")),
    processingOff: readBoolean(raw.processingOff, field(at, "processingOff")),
    targetSource: readOneOf(raw.targetSource, ["builtin", "reference"], field(at, "targetSource")),
    // Older backups have no referenceId; it is only kept when present, so the key never appears as undefined.
    ...(raw.referenceId === undefined ? {} : { referenceId: readId(raw.referenceId, field(at, "referenceId")) }),
  };
}

function readReference(value: unknown, at: Where): ReferenceRecord {
  const raw = readObject(value, at);
  const mimeType = readMimeType(raw.mimeType, field(at, "mimeType"));
  return {
    id: readId(raw.id, field(at, "id")),
    callType: readOneOf<CallType>(raw.callType, CALL_TYPES, field(at, "callType")),
    name: readString(raw.name, field(at, "name"), MAX_NAME_LENGTH),
    createdAt: readTimestamp(raw.createdAt, field(at, "createdAt")),
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
  listName: RecordProblem["list"],
  noun: string,
  read: (value: unknown, at: Where) => T,
): T[] {
  const list = readArray(value, { label: "The backup", path: listName }, MAX_RECORDS_PER_LIST);
  const firstIndexOfId = new Map<string, number>();
  return list.map((raw, i) => {
    const at: Where = { label: `${noun} ${i + 1}`, path: "", record: { list: listName, index: i } };
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
    exportedAt: readDateText(file.exportedAt, field(top, "exportedAt")),
    attempts: readRecords(file.attempts, "attempts", "Attempt", readAttempt),
    references: readRecords(file.references, "references", "Reference", readReference),
  };
}
