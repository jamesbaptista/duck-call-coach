import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
const styles = readFileSync("src/ui/styles.css", "utf8");

/** The light-theme value of a custom property: the first declaration in styles.css. */
function lightColor(property: string): string | undefined {
  return new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, "i").exec(styles)?.[1];
}

/** PNG width and height from the IHDR chunk. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("web app manifest", () => {
  it("names the app and scopes it to the GitHub Pages base path", () => {
    expect(manifest.name).toBe("Duck Call Coach");
    expect(manifest.short_name).toBe("Duck Coach");
    expect(manifest.start_url).toBe("/duck-call-coach/");
    expect(manifest.scope).toBe("/duck-call-coach/");
    expect(manifest.display).toBe("standalone");
  });

  it("takes its colours from styles.css", () => {
    expect(manifest.theme_color).toBe(lightColor("--primary"));
    expect(manifest.background_color).toBe(lightColor("--bg"));
  });

  it("lists 192 px and 512 px icons that exist at that size, one of them maskable", () => {
    const icons: ManifestIcon[] = manifest.icons;
    for (const size of [192, 512]) {
      const icon = icons.find((i) => i.sizes === `${size}x${size}` && (i.purpose ?? "any").split(" ").includes("any"));
      expect(icon, `${size} px icon`).toBeDefined();
      expect(icon?.type).toBe("image/png");
      expect(pngSize(`public/${icon?.src}`)).toEqual([size, size]);
    }
    const maskable = icons.filter((i) => (i.purpose ?? "").split(" ").includes("maskable"));
    expect(maskable.length).toBeGreaterThan(0);
    for (const icon of maskable) expect(pngSize(`public/${icon.src}`)[0]).toBeGreaterThanOrEqual(192);
  });

  it("matches the theme-color meta tag on the page", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
  });
});
