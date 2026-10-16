import { MAX_NAME_LENGTH } from "../../../storage/backupSchema";
import type { ReferenceMeta } from "../../../storage/db";

/** What the References screen says and how it names references, worked out without the DOM. */

export const BUILT_IN_TARGET_TEXT = "Using the built-in target.";

/** At most `maxLength` UTF-16 units (what a backup counts), never splitting an emoji or other surrogate pair. */
function truncate(text: string, maxLength: number): string {
  let result = "";
  for (const character of text) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result;
}

/** The name as saved: trimmed and at most 60 characters. Null when nothing is left, since a name is required. */
export function normalizeReferenceName(input: string): string | null {
  const name = truncate(input.trim(), MAX_NAME_LENGTH).trim();
  return name === "" ? null : name;
}

/** An imported file's suggested name: its file name without the extension, trimmed and cut to fit. May be empty. */
export function nameFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  return normalizeReferenceName(base) ?? "";
}

/** "My reference Oct 16, 2026", the suggested name for a recorded reference. */
export function defaultReferenceName(createdAt: number, dayFormat: Intl.DateTimeFormat): string {
  return `My reference ${dayFormat.format(new Date(createdAt))}`;
}

/** Which target this call's attempts are scored against. */
export function activeTargetText(references: readonly Pick<ReferenceMeta, "name" | "active">[]): string {
  const active = references.find((reference) => reference.active);
  return active ? `Using your reference “${active.name}”.` : BUILT_IN_TARGET_TEXT;
}

export function deleteReferenceQuestion(name: string): string {
  return `Delete the reference “${name}”? This can't be undone.`;
}
