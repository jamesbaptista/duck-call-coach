/**
 * Build-time helpers that turn src/sw-template.js into sw.js. Imported by vite.config.ts only, never by the app,
 * so node:crypto is fine here.
 */
import { createHash } from "node:crypto";

/** A file the build wrote, with its path relative to the output folder. */
export interface OutputFile {
  path: string;
  content: string | Uint8Array;
}

export const SERVICE_WORKER_FILE = "sw.js";
const VERSION_PLACEHOLDER = "__VERSION__";
const ASSETS_PLACEHOLDER = "__ASSETS__";
const VERSION_LENGTH = 12;

/** Public-folder files the app needs offline: the bundled clips, the icons and the manifest. */
const PRECACHED_PUBLIC = [/^clips\/[^/]+\.mp3$/, /^icons\/[^/]+$/, /^manifest\.webmanifest$/];

function toUrlPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function isPrecachedPublicFile(path: string): boolean {
  const urlPath = toUrlPath(path);
  return PRECACHED_PUBLIC.some((pattern) => pattern.test(urlPath));
}

/** Everything Vite emits except the service worker itself, source maps and Vite's own metadata. */
export function isPrecachedBuildFile(path: string): boolean {
  const urlPath = toUrlPath(path);
  return urlPath !== SERVICE_WORKER_FILE && !urlPath.endsWith(".map") && !urlPath.startsWith(".vite/");
}

/** URLs relative to the service worker's scope: "./" (the app's start page) first, then each file, sorted. */
export function precacheUrls(paths: readonly string[]): string[] {
  const urls = paths.map((path) => `./${toUrlPath(path).split("/").map(encodeURIComponent).join("/")}`);
  return ["./", ...[...new Set(urls)].sort()];
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A short hash of every file's path and content: any rename, addition or edit gives a new cache. */
export function cacheVersion(files: readonly OutputFile[]): string {
  const lines = files.map((file) => `${toUrlPath(file.path)}\n${sha256(file.content)}`).sort();
  return sha256(lines.join("\n")).slice(0, VERSION_LENGTH);
}

function replaceOnce(source: string, placeholder: string, value: string): string {
  const parts = source.split(placeholder);
  if (parts.length !== 2) {
    throw new Error(`service worker template must contain ${placeholder} exactly once, found ${parts.length - 1}`);
  }
  // Joining the parts inserts `value` literally; String.replace would expand "$&" and the like.
  return parts.join(value);
}

export function renderServiceWorker(template: string, version: string, urls: readonly string[]): string {
  if (!/^[0-9a-f]+$/.test(version)) throw new Error(`service worker version must be lowercase hex: ${version}`);
  const withVersion = replaceOnce(template, VERSION_PLACEHOLDER, version);
  return replaceOnce(withVersion, ASSETS_PLACEHOLDER, JSON.stringify(urls));
}

/**
 * sw.js for a build: precaches the emitted files plus the public files the app needs offline. The template is
 * part of the version too, so a change to the worker's own caching code starts from a fresh cache.
 */
export function buildServiceWorker(
  template: string,
  buildFiles: readonly OutputFile[],
  publicFiles: readonly OutputFile[],
): string {
  const files = [
    ...buildFiles.filter((file) => isPrecachedBuildFile(file.path)),
    ...publicFiles.filter((file) => isPrecachedPublicFile(file.path)),
  ];
  const version = cacheVersion([...files, { path: SERVICE_WORKER_FILE, content: template }]);
  return renderServiceWorker(template, version, precacheUrls(files.map((file) => file.path)));
}
