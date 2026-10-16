import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** The app's copy uses US spelling: "analyze", "analyzed", "analyzing". (AnalyserNode is a Web API name.) */
const BRITISH_ANALYZE = /\banalys(e|ed|es|ing)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|json|js)$/.test(entry.name) ? [path] : [];
  });
}

describe("spelling", () => {
  it("catches the British forms and leaves analysis and AnalyserNode alone", () => {
    for (const word of ["analyse", "Analysed", "analysing", "analyses"]) expect(BRITISH_ANALYZE.test(word)).toBe(true);
    for (const word of ["analysis", "analyze", "Analyzing", "AnalyserNode", "analyser"]) {
      expect(BRITISH_ANALYZE.test(word)).toBe(false);
    }
  });

  it("uses analyze, analyzed and analyzing everywhere in src/", () => {
    const offenders = sourceFiles("src").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (BRITISH_ANALYZE.test(line) ? [`${relative(".", file)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
