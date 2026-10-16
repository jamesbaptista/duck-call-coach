import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Review Focus 5: user-supplied text must never be parsed as HTML, so src/ never uses these APIs. */
const UNSAFE_HTML_PATTERNS: readonly RegExp[] = [
  /\.innerHTML\s*\+?=(?!=)/,
  /\.outerHTML\s*\+?=(?!=)/,
  /insertAdjacentHTML\s*\(/,
];

function unsafeHtmlUses(source: string): string[] {
  return UNSAFE_HTML_PATTERNS.filter((pattern) => pattern.test(source)).map((pattern) => pattern.source);
}

function typeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("unsafe HTML scan", () => {
  it("catches each forbidden form", () => {
    expect(unsafeHtmlUses("node.innerHTML = name;")).toHaveLength(1);
    expect(unsafeHtmlUses("node.innerHTML+=name;")).toHaveLength(1);
    expect(unsafeHtmlUses("node.outerHTML = name;")).toHaveLength(1);
    expect(unsafeHtmlUses('node.insertAdjacentHTML ("beforeend", name);')).toHaveLength(1);
    expect(unsafeHtmlUses("node.textContent = name;")).toHaveLength(0);
    expect(unsafeHtmlUses("if (node.innerHTML === '') {}")).toHaveLength(0);
  });

  it("finds no innerHTML, outerHTML or insertAdjacentHTML writes in src/", () => {
    const files = typeScriptFiles("src");
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      unsafeHtmlUses(readFileSync(file, "utf8")).map((pattern) => `${relative(".", file)}: ${pattern}`),
    );
    expect(offenders).toEqual([]);
  });
});
