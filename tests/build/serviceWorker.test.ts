import { describe, expect, it } from "vitest";
import {
  buildServiceWorker,
  cacheVersion,
  isPrecachedBuildFile,
  isPrecachedPublicFile,
  precacheUrls,
  renderServiceWorker,
} from "../../src/build/serviceWorker";

const TEMPLATE = 'const VERSION = "__VERSION__";\nconst ASSETS = __ASSETS__;\n';

describe("isPrecachedPublicFile", () => {
  it("takes the bundled clips, the icons and the manifest", () => {
    expect(isPrecachedPublicFile("clips/hail.mp3")).toBe(true);
    expect(isPrecachedPublicFile("icons/icon-192.png")).toBe(true);
    expect(isPrecachedPublicFile("manifest.webmanifest")).toBe(true);
  });

  it("leaves out anything else in public/", () => {
    expect(isPrecachedPublicFile("clips/notes.txt")).toBe(false);
    expect(isPrecachedPublicFile("clips/extra/hail.mp3")).toBe(false);
    expect(isPrecachedPublicFile("robots.txt")).toBe(false);
    expect(isPrecachedPublicFile("icons/sub/icon.png")).toBe(false);
  });

  it("accepts Windows path separators", () => {
    expect(isPrecachedPublicFile("clips\\hail.mp3")).toBe(true);
  });
});

describe("isPrecachedBuildFile", () => {
  it("takes pages, scripts and styles", () => {
    expect(isPrecachedBuildFile("index.html")).toBe(true);
    expect(isPrecachedBuildFile("diagnostics.html")).toBe(true);
    expect(isPrecachedBuildFile("assets/main-CBFN7h0F.js")).toBe(true);
    expect(isPrecachedBuildFile("assets/main-BAbGakm_.css")).toBe(true);
  });

  it("leaves out the service worker itself, source maps and Vite metadata", () => {
    expect(isPrecachedBuildFile("sw.js")).toBe(false);
    expect(isPrecachedBuildFile("assets/main-CBFN7h0F.js.map")).toBe(false);
    expect(isPrecachedBuildFile(".vite/manifest.json")).toBe(false);
  });
});

describe("precacheUrls", () => {
  it("lists the scope root first, then every file relative to the scope, sorted", () => {
    expect(precacheUrls(["index.html", "assets/main-a.js", "clips/hail.mp3"])).toEqual([
      "./",
      "./assets/main-a.js",
      "./clips/hail.mp3",
      "./index.html",
    ]);
  });

  it("uses forward slashes and drops duplicates", () => {
    expect(precacheUrls(["assets\\main-a.js", "assets/main-a.js"])).toEqual(["./", "./assets/main-a.js"]);
  });

  it("percent-encodes characters that are not safe in a URL path", () => {
    expect(precacheUrls(["clips/hen call#1.mp3"])).toEqual(["./", "./clips/hen%20call%231.mp3"]);
  });
});

describe("cacheVersion", () => {
  const files = [
    { path: "index.html", content: "<html>" },
    { path: "clips/hail.mp3", content: new Uint8Array([1, 2, 3]) },
  ];

  it("is a short lowercase hex string", () => {
    expect(cacheVersion(files)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("does not depend on the order files are given in", () => {
    expect(cacheVersion([...files].reverse())).toBe(cacheVersion(files));
  });

  it("changes when a file is renamed, added or edited", () => {
    const base = cacheVersion(files);
    expect(cacheVersion([{ ...files[0], path: "main.html" }, files[1]])).not.toBe(base);
    expect(cacheVersion([...files, { path: "icons/icon-192.png", content: "png" }])).not.toBe(base);
    expect(cacheVersion([files[0], { path: "clips/hail.mp3", content: new Uint8Array([1, 2, 4]) }])).not.toBe(base);
  });

  it("does not confuse a path boundary with content", () => {
    expect(cacheVersion([{ path: "ab", content: "c" }])).not.toBe(cacheVersion([{ path: "a", content: "bc" }]));
  });
});

describe("renderServiceWorker", () => {
  it("fills in the version and the asset list", () => {
    const source = renderServiceWorker(TEMPLATE, "0123456789ab", ["./", "./index.html"]);
    expect(source).toBe('const VERSION = "0123456789ab";\nconst ASSETS = ["./","./index.html"];\n');
  });

  it("inserts URLs literally, even ones that look like replacement patterns", () => {
    const source = renderServiceWorker(TEMPLATE, "0123456789ab", ["./$&.js", "./$1.js"]);
    expect(source).toContain('["./$&.js","./$1.js"]');
  });

  it("refuses a version that is not hex", () => {
    expect(() => renderServiceWorker(TEMPLATE, 'x"; evil();"', ["./"])).toThrow(/version/);
  });

  it("refuses a template without exactly one of each placeholder", () => {
    expect(() => renderServiceWorker("const ASSETS = __ASSETS__;", "0123456789ab", ["./"])).toThrow(/__VERSION__/);
    expect(() => renderServiceWorker('const VERSION = "__VERSION__";', "0123456789ab", ["./"])).toThrow(/__ASSETS__/);
    expect(() => renderServiceWorker(TEMPLATE + TEMPLATE, "0123456789ab", ["./"])).toThrow(/__VERSION__/);
  });
});

describe("buildServiceWorker", () => {
  it("precaches the build output and the public files the app needs, and nothing else", () => {
    const source = buildServiceWorker(
      TEMPLATE,
      [
        { path: "index.html", content: "<html>" },
        { path: "assets/main-a.js", content: "js" },
        { path: "assets/main-a.js.map", content: "{}" },
      ],
      [
        { path: "clips/hail.mp3", content: new Uint8Array([1]) },
        { path: "icons/icon-512.png", content: new Uint8Array([2]) },
        { path: "manifest.webmanifest", content: "{}" },
        { path: "notes.txt", content: "draft" },
      ],
    );
    const assets = JSON.parse(/const ASSETS = (\[.*\]);/.exec(source)?.[1] ?? "null");
    expect(assets).toEqual([
      "./",
      "./assets/main-a.js",
      "./clips/hail.mp3",
      "./icons/icon-512.png",
      "./index.html",
      "./manifest.webmanifest",
    ]);
    expect(source).toMatch(/const VERSION = "[0-9a-f]{12}";/);
  });

  it("gives a new version when only a public file's content changes", () => {
    const build = [{ path: "index.html", content: "<html>" }];
    const before = buildServiceWorker(TEMPLATE, build, [{ path: "clips/hail.mp3", content: new Uint8Array([1]) }]);
    const after = buildServiceWorker(TEMPLATE, build, [{ path: "clips/hail.mp3", content: new Uint8Array([9]) }]);
    expect(after).not.toBe(before);
  });

  it("gives a new version when only the worker's own code changes", () => {
    const build = [{ path: "index.html", content: "<html>" }];
    const version = (source: string): string | undefined => /const VERSION = "(\w+)";/.exec(source)?.[1];
    const before = buildServiceWorker(TEMPLATE, build, []);
    const after = buildServiceWorker(`${TEMPLATE}// new caching rule\n`, build, []);
    expect(version(after)).not.toBe(version(before));
  });

  it("ignores files it does not precache when computing the version", () => {
    const build = [{ path: "index.html", content: "<html>" }];
    const before = buildServiceWorker(TEMPLATE, build, [{ path: "notes.txt", content: "a" }]);
    const after = buildServiceWorker(TEMPLATE, build, [{ path: "notes.txt", content: "b" }]);
    expect(after).toBe(before);
  });
});
