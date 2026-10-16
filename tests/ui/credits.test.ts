import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credits, DIAGNOSTICS_PATH, notUsed } from "../../src/ui/screens/credits";

/** The Credits screen must say exactly what CREDITS.md says, and cover every clip the app ships. */

const CREDITS_MD = readFileSync("CREDITS.md", "utf8");

const TABLE_ROW = /^\| \[(XC\d+)\]\((\S+)\) \| (.+?) \| \[(.+?)\]\((\S+)\) \| (.+) \|$/;

function tableRows(markdown: string): Record<string, string>[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => TABLE_ROW.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, recording, recordingUrl, recordist, license, licenseUrl, usedFor]) => ({
      recording,
      recordingUrl,
      recordist,
      license,
      licenseUrl,
      // The screen shows file names as plain text.
      usedFor: usedFor.replaceAll("`", ""),
    }));
}

function notUsedSection(markdown: string): string {
  const start = markdown.indexOf("## Recordings not used");
  const end = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, end).replace(/\s+/g, " ");
}

describe("credits", () => {
  it("lists the recordings of CREDITS.md's table, in order, with the same details", () => {
    const rows = tableRows(CREDITS_MD);
    expect(rows.length).toBeGreaterThan(0);
    expect(credits).toEqual(rows);
  });

  it("names every clip the app ships", () => {
    const clips = readdirSync("public/clips");
    expect(clips.length).toBeGreaterThan(0);
    for (const clip of clips) {
      expect(credits.some((credit) => credit.usedFor.includes(clip)), clip).toBe(true);
    }
  });

  it("lists the recordings CREDITS.md says are not used, with their license and reason", () => {
    const section = notUsedSection(CREDITS_MD);
    expect(notUsed.length).toBeGreaterThan(0);
    for (const recording of notUsed) {
      expect(section).toContain(`[${recording.recording}](${recording.recordingUrl}) (${recording.recordist})`);
      expect(section).toContain(`[${recording.license}](${recording.licenseUrl})`);
      expect(section).toContain(recording.reason);
      expect(credits.some((credit) => credit.recording === recording.recording)).toBe(false);
    }
  });

  it("links only to xeno-canto and Creative Commons over https", () => {
    const urls = [...credits, ...notUsed].flatMap((credit) => [credit.recordingUrl, credit.licenseUrl]);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/(xeno-canto\.org|creativecommons\.org)\//);
    }
  });
});

describe("Mic check link", () => {
  it("points at the diagnostics page the build ships", () => {
    expect(DIAGNOSTICS_PATH).toBe("diagnostics.html");
    expect(existsSync(DIAGNOSTICS_PATH)).toBe(true);
    expect(readFileSync("vite.config.ts", "utf8")).toContain(`diagnostics: "${DIAGNOSTICS_PATH}"`);
  });
});
