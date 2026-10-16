/**
 * The short build id the Credits screen shows, so the owner can tell which deploy a phone is running. Worked out by
 * vite.config.ts at build time and injected as __BUILD_ID__.
 */

/** What the development server shows instead of a build id. */
export const DEV_BUILD_ID = "dev";

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
const SHORT_SHA_LENGTH = 8;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The first 8 characters of the commit being built (GitHub Actions sets GITHUB_SHA), else the UTC time of the build
 * as "20261016-0905". Anything that isn't a hex hash is ignored, so the id is always safe to show.
 */
export function buildId(commitSha: string | undefined, builtAt: Date): string {
  if (commitSha !== undefined && COMMIT_SHA.test(commitSha)) return commitSha.slice(0, SHORT_SHA_LENGTH).toLowerCase();
  const date = `${builtAt.getUTCFullYear()}${pad(builtAt.getUTCMonth() + 1)}${pad(builtAt.getUTCDate())}`;
  return `${date}-${pad(builtAt.getUTCHours())}${pad(builtAt.getUTCMinutes())}`;
}
