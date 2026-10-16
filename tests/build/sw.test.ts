import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Every file under `dir`, relative to it, with forward slashes. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

describe("production build service worker", () => {
  let outDir = "";
  let sw = "";
  let assets: string[] = [];

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "duck-call-coach-build-"));
    await build({ configFile: "vite.config.ts", logLevel: "silent", build: { outDir, emptyOutDir: true } });
    sw = readFileSync(join(outDir, "sw.js"), "utf8");
    assets = JSON.parse(/const ASSETS = (\[.*?\]);/s.exec(sw)?.[1] ?? "[]");
  }, 60_000);

  afterAll(() => {
    if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
  });

  it("has no placeholders left", () => {
    expect(sw).not.toContain("__ASSETS__");
    expect(sw).not.toContain("__VERSION__");
    expect(sw).toMatch(/const VERSION = "[0-9a-f]{12}";/);
  });

  it("precaches both pages, a bundled clip and the hashed main script", () => {
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    const mainScript = /<script type="module" crossorigin src="\/duck-call-coach\/(assets\/main-[^"]+\.js)"/.exec(html)?.[1];
    expect(mainScript).toBeDefined();
    expect(assets).toEqual(
      expect.arrayContaining(["./", "./index.html", "./diagnostics.html", "./clips/hail.mp3", `./${mainScript}`]),
    );
  });

  it("precaches every file the build wrote except itself", () => {
    const written = filesUnder(outDir).filter((path) => path !== "sw.js");
    expect(assets.filter((url) => url !== "./").map((url) => url.slice(2)).sort()).toEqual(written.sort());
  });

  it("precaches the manifest and both icons", () => {
    expect(assets).toEqual(
      expect.arrayContaining(["./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"]),
    );
  });

  it("links the manifest, icon and theme colour from the page under the base path", () => {
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('<link rel="manifest" href="/duck-call-coach/manifest.webmanifest"');
    expect(html).toContain('<link rel="icon" type="image/png" href="/duck-call-coach/icons/icon-192.png"');
    expect(html).toContain('<meta name="theme-color"');
    const diagnostics = readFileSync(join(outDir, "diagnostics.html"), "utf8");
    expect(diagnostics).toContain('<link rel="icon" type="image/png" href="/duck-call-coach/icons/icon-192.png"');
  });
});
